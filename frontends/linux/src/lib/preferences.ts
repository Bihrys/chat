export type Locale = "zh-CN" | "en";
export type ThemeMode = "dark" | "light";

const LOCALE_STORAGE_KEY = "chat.preferences.locale.v1";
const THEME_STORAGE_KEY = "chat.preferences.theme.v1";

export const translations = {
  "zh-CN": {
    appName: "安全聊天",
    localDevelopment: "本地开发环境",
    createAccountTitle: "创建账号",
    welcomeBack: "欢迎回来",
    authIntro:
      "注册自定义用户名和密码，或使用已有账号登录。密码以 Argon2id 哈希保存；当前开发阶段的消息尚未启用端到端加密。",
    register: "注册",
    login: "登录",
    username: "用户名",
    usernameHint: "3–32 个字符，仅支持英文字母、数字和下划线。",
    displayName: "显示名称",
    password: "密码",
    passwordHint: "至少 8 个字符。",
    confirmPassword: "确认密码",
    passwordsMismatch: "两次输入的密码不一致。",
    pleaseWait: "请稍候…",
    createAccount: "创建账号",
    restoringSession: "正在恢复会话…",
    logout: "退出登录",
    settings: "设置",
    closeSettings: "关闭设置",
    language: "语言",
    appearance: "外观",
    chinese: "中文",
    english: "English",
    darkMode: "深色模式",
    darkModeDescription: "黑灰色界面",
    lightMode: "亮色模式",
    lightModeDescription: "白色界面",
    startConversation: "发起会话",
    searchRegisteredUsers: "搜索已注册用户",
    noMatchingUsers: "没有匹配的已注册用户。",
    conversations: "会话",
    messages: "消息",
    noConversations: "在上方搜索其他已注册用户，开始第一次聊天。",
    unknownUser: "未知用户",
    noMessagesYet: "暂无消息",
    conversation: "会话",
    plaintextDev: "明文开发版 V0",
    emptyMessagesTitle: "还没有消息",
    emptyMessagesBody: "发送这段本地开发聊天中的第一条消息。",
    writeMessage: "输入消息",
    send: "发送",
    landingBody:
      "选择一个会话，或搜索其他已注册用户。当前消息载荷仅在本地开发阶段以明文保存。",
    realtimeConnected: "实时连接已建立",
    realtimeConnecting: "实时连接中",
    realtimeOffline: "实时连接已断开",
    rustCore: "Rust 核心",
  },
  en: {
    appName: "Secure Chat",
    localDevelopment: "Local Development",
    createAccountTitle: "Create your account",
    welcomeBack: "Welcome back",
    authIntro:
      "Register a custom username and password, or sign in to an existing account. Passwords are stored as Argon2id hashes; messages are not yet end-to-end encrypted.",
    register: "Register",
    login: "Log in",
    username: "Username",
    usernameHint: "3–32 letters, numbers, or underscores.",
    displayName: "Display name",
    password: "Password",
    passwordHint: "At least 8 characters.",
    confirmPassword: "Confirm password",
    passwordsMismatch: "Passwords do not match.",
    pleaseWait: "Please wait…",
    createAccount: "Create account",
    restoringSession: "Restoring your session…",
    logout: "Log out",
    settings: "Settings",
    closeSettings: "Close settings",
    language: "Language",
    appearance: "Appearance",
    chinese: "中文",
    english: "English",
    darkMode: "Dark mode",
    darkModeDescription: "Black and gray interface",
    lightMode: "Light mode",
    lightModeDescription: "White interface",
    startConversation: "Start a conversation",
    searchRegisteredUsers: "Search registered users",
    noMatchingUsers: "No matching registered users.",
    conversations: "Conversations",
    messages: "Messages",
    noConversations:
      "Search for another registered user above to start the first chat.",
    unknownUser: "Unknown user",
    noMessagesYet: "No messages yet",
    conversation: "Conversation",
    plaintextDev: "PLAINTEXT DEV V0",
    emptyMessagesTitle: "No messages yet",
    emptyMessagesBody: "Send the first message in this local development chat.",
    writeMessage: "Write a message",
    send: "Send",
    landingBody:
      "Choose a conversation or search for another registered user. The current message payload remains plaintext only for this local development stage.",
    realtimeConnected: "Realtime connected",
    realtimeConnecting: "Realtime connecting",
    realtimeOffline: "Realtime offline",
    rustCore: "Rust core",
  },
} as const;

export type Translation = (typeof translations)[Locale];

export function readStoredLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "en" || stored === "zh-CN" ? stored : "zh-CN";
}

export function storeLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

export function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "dark";
}

export function storeTheme(theme: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyDocumentPreferences(locale: Locale, theme: ThemeMode) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
