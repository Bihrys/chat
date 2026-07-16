const authBase = process.env.CHAT_AUTH_SERVICE_URL ?? "http://127.0.0.1:61001";
const accountBase = process.env.CHAT_ACCOUNT_SERVICE_URL ?? "http://127.0.0.1:61002";
const mailboxBase = process.env.CHAT_MAILBOX_SERVICE_URL ?? "http://127.0.0.1:62003";
const mailboxWs = mailboxBase.replace(/^http/, "ws");
const stamp = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const password = `SmokeTest_${stamp}!`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function register(username, displayName) {
  return json(`${authBase}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, display_name: displayName, password }),
  });
}

function authorized(accessToken, jsonBody = true) {
  return {
    ...(jsonBody ? { "content-type": "application/json" } : {}),
    authorization: `Bearer ${accessToken}`,
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

console.log("[1/15] Registering Alice, Bob, and Carol...");
const aliceSession = await register(`alice_${stamp}`, "Alice Smoke Test");
const bobSession = await register(`bob_${stamp}`, "Bob Smoke Test");
const carolSession = await register(`carol_${stamp}`, "Carol Smoke Test");
const alice = aliceSession.account;
const bob = bobSession.account;
const carol = carolSession.account;
assert(alice.chat_id && bob.chat_id && carol.chat_id, "public chat IDs were not generated");

console.log("[2/15] Looking Bob up by exact Chat ID...");
const foundBob = await json(
  `${accountBase}/v1/accounts/lookup?identifier=${encodeURIComponent(bob.chat_id)}`,
  { headers: authorized(aliceSession.access_token, false) },
);
assert(foundBob.account_id === bob.account_id, "exact Chat ID lookup failed");

console.log("[3/15] Sending a friend request...");
await json(`${accountBase}/v1/friend-requests`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({
    recipient_account_id: bob.account_id,
    message: `Hi, I'm ${alice.display_name}`,
  }),
});

console.log("[4/15] Bob accepts the request...");
const bobRequests = await json(`${accountBase}/v1/friend-requests`, {
  headers: authorized(bobSession.access_token, false),
});
const incoming = bobRequests.incoming.find(
  (request) =>
    request.sender_account_id === alice.account_id && request.status === "pending",
);
assert(incoming, "Bob did not receive Alice's friend request");
await json(`${accountBase}/v1/friend-requests/${incoming.request_id}/accept`, {
  method: "POST",
  headers: authorized(bobSession.access_token),
  body: "{}",
});

console.log("[5/15] Creating a direct conversation between contacts...");
const conversation = await json(`${mailboxBase}/v1/conversations/direct`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ peer_account_id: bob.account_id }),
});

console.log("[6/15] Connecting Bob's authenticated realtime WebSocket...");
const socket = new WebSocket(
  `${mailboxWs}/v1/ws?access_token=${encodeURIComponent(bobSession.access_token)}`,
);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("WebSocket connect timed out")), 5_000);
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timeout);
      resolve();
    },
    { once: true },
  );
  socket.addEventListener(
    "error",
    () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connect failed"));
    },
    { once: true },
  );
});

console.log("[7/15] Sending and receiving a direct message...");
const directClientId = crypto.randomUUID();
const directEvent = waitForEvent(
  socket,
  (event) =>
    event.type === "message_created" &&
    event.payload?.message?.client_message_id === directClientId,
);
const directMessage = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages`,
  {
    method: "POST",
    headers: authorized(aliceSession.access_token),
    body: JSON.stringify({
      client_message_id: directClientId,
      body: `direct hello ${stamp}`,
    }),
  },
);
assert(
  (await directEvent).payload.message.message_id === directMessage.message_id,
  "direct realtime event mismatch",
);

console.log("[8/15] Verifying direct history and unread state...");
const history = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages?limit=200`,
  { headers: authorized(bobSession.access_token, false) },
);
assert(
  history.some((message) => message.message_id === directMessage.message_id),
  "direct message missing from history",
);

console.log("[9/15] Creating a group with Bob as an initial member...");
const group = await json(`${mailboxBase}/v1/groups`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({
    name: `Smoke Group ${stamp}`,
    member_account_ids: [bob.account_id],
  }),
});
assert(group.group_code?.startsWith("G"), "group code was not generated");
assert(group.actor_role === "owner", "creator is not the group owner");

console.log("[10/15] Looking the group up by exact Group ID...");
const discoveredGroup = await json(
  `${mailboxBase}/v1/groups/lookup?identifier=${encodeURIComponent(group.group_code)}`,
  { headers: authorized(carolSession.access_token, false) },
);
assert(discoveredGroup.group_id === group.group_id, "exact Group ID lookup failed");
assert(discoveredGroup.actor_role === null, "Carol should not already be a member");

console.log("[11/15] Carol sends a moderated group join request...");
await json(`${mailboxBase}/v1/groups/${group.group_id}/join-requests`, {
  method: "POST",
  headers: authorized(carolSession.access_token),
  body: JSON.stringify({ message: `Hi, I'm ${carol.display_name}` }),
});
const pendingDiscovery = await json(
  `${mailboxBase}/v1/groups/lookup?identifier=${encodeURIComponent(group.group_code)}`,
  { headers: authorized(carolSession.access_token, false) },
);
assert(
  pendingDiscovery.join_request_status === "pending",
  "Carol's group join request was not marked pending",
);

console.log("[12/15] Alice reviews and accepts Carol's join request...");
const groupRequests = await json(
  `${mailboxBase}/v1/groups/${group.group_id}/join-requests`,
  { headers: authorized(aliceSession.access_token, false) },
);
const carolRequest = groupRequests.find(
  (request) => request.applicant_account_id === carol.account_id,
);
assert(carolRequest, "Alice could not see Carol's pending group join request");
await json(
  `${mailboxBase}/v1/groups/${group.group_id}/join-requests/${carolRequest.request_id}/accept`,
  {
    method: "POST",
    headers: authorized(aliceSession.access_token),
    body: "{}",
  },
);

console.log("[13/15] Verifying Carol is now a group member...");
const carolGroup = await json(`${mailboxBase}/v1/groups/${group.group_id}`, {
  headers: authorized(carolSession.access_token, false),
});
assert(carolGroup.actor_role === "member", "Carol was not added as a group member");
assert(carolGroup.members.length === 3, "group should contain three members");
const carolConversations = await json(`${mailboxBase}/v1/conversations`, {
  headers: authorized(carolSession.access_token, false),
});
assert(
  carolConversations.some((item) => item.conversation_id === group.conversation_id),
  "approved group did not appear in Carol's conversations",
);

console.log("[14/15] Sending and receiving a group message...");
const groupClientId = crypto.randomUUID();
const groupEvent = waitForEvent(
  socket,
  (event) =>
    event.type === "message_created" &&
    event.payload?.message?.client_message_id === groupClientId,
);
const groupMessage = await json(
  `${mailboxBase}/v1/conversations/${group.conversation_id}/messages`,
  {
    method: "POST",
    headers: authorized(aliceSession.access_token),
    body: JSON.stringify({
      client_message_id: groupClientId,
      body: `group hello ${stamp}`,
    }),
  },
);
assert(
  (await groupEvent).payload.message.message_id === groupMessage.message_id,
  "group realtime event mismatch",
);

console.log("[15/15] Contacts, direct chat, Group ID search, join approval, and group chat passed.");
console.log(
  JSON.stringify(
    {
      alice: alice.account_id,
      alice_chat_id: alice.chat_id,
      bob: bob.account_id,
      bob_chat_id: bob.chat_id,
      carol: carol.account_id,
      carol_chat_id: carol.chat_id,
      direct_conversation: conversation.conversation_id,
      group: group.group_id,
      group_code: group.group_code,
    },
    null,
    2,
  ),
);

socket.close();
