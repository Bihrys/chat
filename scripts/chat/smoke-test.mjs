const accountBase = process.env.CHAT_ACCOUNT_SERVICE_URL ?? "http://127.0.0.1:61002";
const mailboxBase = process.env.CHAT_MAILBOX_SERVICE_URL ?? "http://127.0.0.1:62003";
const mailboxWs = mailboxBase.replace(/^http/, "ws");
const stamp = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${url}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function createAccount(username, displayName) {
  return json(`${accountBase}/v1/dev/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, display_name: displayName }),
  });
}

function actor(accountId) {
  return {
    "content-type": "application/json",
    "x-chat-account-id": accountId,
  };
}

function waitForEvent(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for WebSocket event"));
    }, timeoutMs);

    const onMessage = (message) => {
      const event = JSON.parse(String(message.data));
      if (predicate(event)) {
        cleanup();
        resolve(event);
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("WebSocket failed during smoke test"));
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    }

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}

console.log("[1/7] Creating two isolated local development profiles...");
const alice = await createAccount(`alice_${stamp}`, "Alice Smoke Test");
const bob = await createAccount(`bob_${stamp}`, "Bob Smoke Test");

console.log("[2/7] Creating a direct conversation...");
const conversation = await json(`${mailboxBase}/v1/conversations/direct`, {
  method: "POST",
  headers: actor(alice.account_id),
  body: JSON.stringify({ peer_account_id: bob.account_id }),
});

console.log("[3/7] Connecting Bob's realtime WebSocket...");
const socket = new WebSocket(`${mailboxWs}/v1/ws?account_id=${encodeURIComponent(bob.account_id)}`);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("WebSocket connect timed out")), 5_000);
  socket.addEventListener("open", () => {
    clearTimeout(timeout);
    resolve();
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("WebSocket connect failed"));
  }, { once: true });
});

const body = `hello from the basic chat smoke test ${stamp}`;
const clientMessageId = crypto.randomUUID();
const eventPromise = waitForEvent(
  socket,
  (event) => event.type === "message_created" && event.payload?.message?.client_message_id === clientMessageId,
);

console.log("[4/7] Persisting Alice's message and waiting for Bob's realtime event...");
const created = await json(`${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages`, {
  method: "POST",
  headers: actor(alice.account_id),
  body: JSON.stringify({ client_message_id: clientMessageId, body }),
});
const realtime = await eventPromise;
assert(realtime.payload.message.message_id === created.message_id, "realtime event did not match persisted message");

console.log("[5/7] Verifying Bob can recover history from PostgreSQL...");
const history = await json(`${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages?limit=200`, {
  headers: actor(bob.account_id),
});
assert(history.some((message) => message.message_id === created.message_id && message.body === body), "persisted message missing from history");

console.log("[6/7] Verifying unread state, then marking the conversation read...");
let conversations = await json(`${mailboxBase}/v1/conversations`, { headers: actor(bob.account_id) });
let bobConversation = conversations.find((item) => item.conversation_id === conversation.conversation_id);
assert(bobConversation?.unread_count === 1, `expected unread_count=1, got ${bobConversation?.unread_count}`);

await json(`${mailboxBase}/v1/conversations/${conversation.conversation_id}/read`, {
  method: "POST",
  headers: actor(bob.account_id),
  body: "{}",
});
conversations = await json(`${mailboxBase}/v1/conversations`, { headers: actor(bob.account_id) });
bobConversation = conversations.find((item) => item.conversation_id === conversation.conversation_id);
assert(bobConversation?.unread_count === 0, `expected unread_count=0, got ${bobConversation?.unread_count}`);

console.log("[7/7] Basic chat vertical slice passed.");
console.log(JSON.stringify({
  alice: alice.account_id,
  bob: bob.account_id,
  conversation: conversation.conversation_id,
  message: created.message_id,
}, null, 2));

socket.close();
