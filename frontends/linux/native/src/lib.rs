#[derive(serde::Serialize)]
struct WindowChromeState {
    decorated: bool,
}

#[tauri::command]
fn backend_status() -> &'static str {
    "ready"
}

#[tauri::command]
fn window_action(window: tauri::WebviewWindow, action: &str) -> Result<(), String> {
    match action {
        "minimize" => window.minimize().map_err(|error| error.to_string()),
        "toggle_maximize" => {
            let is_maximized = window
                .is_maximized()
                .map_err(|error| error.to_string())?;

            if is_maximized {
                window.unmaximize()
            } else {
                window.maximize()
            }
            .map_err(|error| error.to_string())
        }
        "close" => window.close().map_err(|error| error.to_string()),
        _ => Err(format!("unsupported window action: {action}")),
    }
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

#[cfg(target_os = "linux")]
fn install_linux_media_permission_handler(
    app: &tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    use webkit2gtk::{prelude::*, UserMediaPermissionRequest};

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::other("main webview window is unavailable"))?;

    window
        .with_webview(|webview| {
            webview
                .inner()
                .connect_permission_request(|_, request| {
                    // Only grant microphone/camera capture requests. Other WebKit
                    // permissions continue through their default deny/prompt path.
                    if request.is::<UserMediaPermissionRequest>() {
                        request.allow();
                        true
                    } else {
                        false
                    }
                });
        })?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            install_linux_media_permission_handler(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_status,
            configure_main_window,
            window_action
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
