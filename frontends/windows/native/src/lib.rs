#[tauri::command]
fn backend_status() -> &'static str {
    "ready"
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_status])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
