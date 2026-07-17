#[derive(serde::Serialize)]
struct WindowChromeState {
    decorated: bool,
}

#[tauri::command]
fn backend_status() -> &'static str {
    "ready"
}

#[tauri::command]
fn configure_main_window(
    window: tauri::WebviewWindow,
) -> Result<WindowChromeState, String> {
    // A zero-width title prevents GTK from falling back to the product name
    // when a Wayland compositor keeps native decorations enabled.
    window
        .set_title("\u{200b}")
        .map_err(|error| error.to_string())?;

    // Ask for a frameless window at runtime as well as in tauri.conf.json.
    // Some Linux/Wayland combinations ignore one of the two paths.
    let _ = window.set_decorations(false);

    let decorated = window.is_decorated().unwrap_or(true);
    Ok(WindowChromeState { decorated })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            backend_status,
            configure_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
