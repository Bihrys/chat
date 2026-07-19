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

console.log("[1/22] Registering Alice, Bob, and Carol...");
const aliceSession = await register(`alice_${stamp}`, "Alice Smoke Test");
const bobSession = await register(`bob_${stamp}`, "Bob Smoke Test");
const carolSession = await register(`carol_${stamp}`, "Carol Smoke Test");
const alice = aliceSession.account;
const bob = bobSession.account;
const carol = carolSession.account;
assert(alice.chat_id && bob.chat_id && carol.chat_id, "public chat IDs were not generated");

console.log("[2/22] Looking Bob up by exact Chat ID...");
const foundBob = await json(
  `${accountBase}/v1/accounts/lookup?identifier=${encodeURIComponent(bob.chat_id)}`,
  { headers: authorized(aliceSession.access_token, false) },
);
assert(foundBob.account_id === bob.account_id, "exact Chat ID lookup failed");

console.log("[3/22] Sending a friend request...");
await json(`${accountBase}/v1/friend-requests`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({
    recipient_account_id: bob.account_id,
    message: `Hi, I'm ${alice.display_name}`,
  }),
});

console.log("[4/22] Bob accepts the request...");
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

console.log("[5/22] Updating Alice's avatar profile...");
const avatarDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const aliceWithAvatar = await json(`${accountBase}/v1/profile/avatar`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ avatar_data_url: avatarDataUrl }),
});
assert(aliceWithAvatar.avatar_data_url === avatarDataUrl, "avatar update failed");

console.log("[6/22] Persisting nine-level UI preferences...");
const uiPreferences = await json(`${accountBase}/v1/profile/ui-preferences`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ locale: "zh-CN", theme: "light", font_size_level: 8 }),
});
assert(uiPreferences.font_size_level === 8, "font-size preference update failed");
const storedUiPreferences = await json(`${accountBase}/v1/profile/ui-preferences`, {
  headers: authorized(aliceSession.access_token, false),
});
assert(storedUiPreferences.theme === "light", "UI preferences were not persisted");

console.log("[7/22] Saving and reading a contact remark...");
const bobRemark = `Bob Remark ${stamp}`;
await json(`${accountBase}/v1/contacts/${bob.account_id}`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ remark_name: bobRemark }),
});
const bobContact = await json(`${accountBase}/v1/contacts/${bob.account_id}`, {
  headers: authorized(aliceSession.access_token, false),
});
assert(bobContact.remark_name === bobRemark, "contact remark update failed");
const bobTags = `school,smoke-${stamp}`;
await json(`${accountBase}/v1/contacts/${bob.account_id}/tags`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ tags: bobTags }),
});
await json(`${accountBase}/v1/contacts/${bob.account_id}/permission`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ permission: "chat_only" }),
});
const starredBob = await json(`${accountBase}/v1/contacts/${bob.account_id}/star`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ enabled: true }),
});
assert(starredBob.tags === bobTags, "contact tags update failed");
assert(starredBob.friend_permission === "chat_only", "friend permission update failed");
assert(starredBob.is_starred === true, "starred contact update failed");

console.log("[8/22] Creating a direct conversation between contacts...");
const conversation = await json(`${mailboxBase}/v1/conversations/direct`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ peer_account_id: bob.account_id }),
});

console.log("[9/22] Connecting Bob's authenticated realtime WebSocket...");
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

console.log("[10/22] Sending and receiving a direct message...");
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

console.log("[11/22] Recalling a message within two minutes...");
const recallClientId = crypto.randomUUID();
const recallCreatedEvent = waitForEvent(
  socket,
  (event) =>
    event.type === "message_created"
    && event.payload?.message?.client_message_id === recallClientId,
);
const recallCandidate = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages`,
  {
    method: "POST",
    headers: authorized(aliceSession.access_token),
    body: JSON.stringify({
      client_message_id: recallClientId,
      body: `recall me ${stamp}`,
    }),
  },
);
await recallCreatedEvent;
const recallEvent = waitForEvent(
  socket,
  (event) =>
    event.type === "message_recalled"
    && event.payload?.message?.message_id === recallCandidate.message_id,
);
const recalledMessage = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages/${recallCandidate.message_id}/recall`,
  {
    method: "POST",
    headers: authorized(aliceSession.access_token, false),
  },
);
assert(recalledMessage.payload_format === "recalled_v0", "recall response format mismatch");
assert((await recallEvent).payload.message.payload_format === "recalled_v0", "recall realtime event mismatch");

console.log("[12/22] Uploading, sending, downloading, and receiving an image message...");
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mediaObject = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/media?kind=image&file_name=smoke.png`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${aliceSession.access_token}`,
      "content-type": "image/png",
    },
    body: pngBytes,
  },
);
assert(mediaObject.media_kind === "image", "media upload kind mismatch");
const mediaClientId = crypto.randomUUID();
const mediaEvent = waitForEvent(
  socket,
  (event) => event.type === "message_created" && event.payload?.message?.client_message_id === mediaClientId,
);
const mediaPayload = {
  object_id: mediaObject.object_id,
  media_kind: mediaObject.media_kind,
  file_name: mediaObject.file_name,
  content_type: mediaObject.content_type,
  byte_len: mediaObject.byte_len,
  width: 1,
  height: 1,
};
const mediaMessage = await json(`${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({
    client_message_id: mediaClientId,
    payload_format: "media_v0",
    body: JSON.stringify(mediaPayload),
  }),
});
assert((await mediaEvent).payload.message.message_id === mediaMessage.message_id, "media realtime event mismatch");
const downloadedMedia = await fetch(`${mailboxBase}/v1/media/${mediaObject.object_id}`, {
  headers: authorized(bobSession.access_token, false),
});
assert(downloadedMedia.ok, "media download failed");
assert((await downloadedMedia.arrayBuffer()).byteLength === pngBytes.byteLength, "media download length mismatch");

console.log("[13/22] Relaying an authenticated audio-call offer over WebSocket...");
const callId = crypto.randomUUID();
const callEvent = waitForEvent(
  socket,
  (event) => event.type === "call_signal" && event.payload?.signal?.call_id === callId,
);
await json(`${mailboxBase}/v1/calls/signals`, {
  method: "POST",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({
    call_id: callId,
    conversation_id: conversation.conversation_id,
    to_account_id: bob.account_id,
    media: "audio",
    signal_type: "offer",
    payload: { type: "offer", sdp: "smoke-test" },
  }),
});
const relayedCall = await callEvent;
assert(relayedCall.payload.signal.from_account_id === alice.account_id, "call signal sender mismatch");

console.log("[14/22] Verifying direct history and unread state...");
const history = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages?limit=200`,
  { headers: authorized(bobSession.access_token, false) },
);
assert(
  history.some((message) => message.message_id === directMessage.message_id),
  "direct message missing from history",
);
const searchResults = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages/search?q=${encodeURIComponent(`hello ${stamp}`)}&limit=200`,
  { headers: authorized(bobSession.access_token, false) },
);
assert(
  searchResults.some((message) => message.message_id === directMessage.message_id),
  "server-side chat-content search failed",
);
await json(`${mailboxBase}/v1/conversations/${conversation.conversation_id}/preferences`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ is_pinned: true, is_muted: true }),
});
const preferredConversations = await json(`${mailboxBase}/v1/conversations`, {
  headers: authorized(aliceSession.access_token, false),
});
const preferredDirect = preferredConversations.find(
  (item) => item.conversation_id === conversation.conversation_id,
);
assert(preferredDirect?.is_pinned === true, "pin chat preference failed");
assert(preferredDirect?.is_muted === true, "mute chat preference failed");
await json(`${mailboxBase}/v1/conversations/${conversation.conversation_id}/history`, {
  method: "DELETE",
  headers: authorized(aliceSession.access_token, false),
});
const clearedHistory = await json(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages?limit=200`,
  { headers: authorized(aliceSession.access_token, false) },
);
assert(clearedHistory.length === 0, "per-account chat history clear failed");

console.log("[15/22] Creating a group with Bob as an initial member...");
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

console.log("[16/22] Verifying common-group discovery for contacts...");
const commonGroups = await json(
  `${mailboxBase}/v1/contacts/${bob.account_id}/common-groups`,
  { headers: authorized(aliceSession.access_token, false) },
);
assert(
  commonGroups.some((item) => item.group_id === group.group_id),
  "new group was not returned as a common group",
);

console.log("[17/22] Looking the group up by exact Group ID...");
const discoveredGroup = await json(
  `${mailboxBase}/v1/groups/lookup?identifier=${encodeURIComponent(group.group_code)}`,
  { headers: authorized(carolSession.access_token, false) },
);
assert(discoveredGroup.group_id === group.group_id, "exact Group ID lookup failed");
assert(discoveredGroup.actor_role === null, "Carol should not already be a member");

console.log("[18/22] Carol sends a moderated group join request...");
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

console.log("[19/22] Alice reviews and accepts Carol's join request...");
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

console.log("[20/22] Verifying Carol is now a group member...");
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

console.log("[21/22] Sending and receiving a group message...");
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

const blockedBob = await json(`${accountBase}/v1/contacts/${bob.account_id}/block`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ enabled: true }),
});
assert(blockedBob.is_blocked === true, "blacklist update failed");
const blockedSend = await fetch(
  `${mailboxBase}/v1/conversations/${conversation.conversation_id}/messages`,
  {
    method: "POST",
    headers: authorized(aliceSession.access_token),
    body: JSON.stringify({
      client_message_id: crypto.randomUUID(),
      body: "this must be rejected",
    }),
  },
);
assert(blockedSend.status === 403, "blacklisted direct message was not rejected");
await json(`${accountBase}/v1/contacts/${bob.account_id}/block`, {
  method: "PATCH",
  headers: authorized(aliceSession.access_token),
  body: JSON.stringify({ enabled: false }),
});
await json(`${accountBase}/v1/contacts/${bob.account_id}`, {
  method: "DELETE",
  headers: authorized(aliceSession.access_token, false),
});
const contactsAfterDelete = await json(`${accountBase}/v1/contacts`, {
  headers: authorized(aliceSession.access_token, false),
});
assert(
  !contactsAfterDelete.some((item) => item.account_id === bob.account_id),
  "contact deletion failed",
);

console.log("[22/22] Contacts, message recall, nine-level preferences, media transfer, call signaling, direct chat, Group ID search, join approval, and group chat passed.");
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
