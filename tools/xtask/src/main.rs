use std::{
    env,
    path::PathBuf,
    process::{Command, ExitCode},
};

fn root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    match manifest_dir.parent().and_then(|path| path.parent()) {
        Some(root) => root.to_path_buf(),
        None => PathBuf::from("."),
    }
}

fn run(program: &str, args: &[&str]) -> ExitCode {
    let status = Command::new(program)
        .args(args)
        .current_dir(root())
        .status();

    match status {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("failed to run {program}: {error}");
            ExitCode::FAILURE
        }
    }
}

fn help() {
    println!(
        "chat xtask\n\n\
         Commands:\n  \
         check\n  \
         bootstrap\n  \
         infra up|down|status\n  \
         chat up|down|status|smoke\n  \
         services build|start|stop|status|restart [name|all]\n  \
         linux dev|build|typecheck\n"
    );
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.as_slice() {
        [cmd] if cmd == "check" => run("bash", &["scripts/dev/check-workspace.sh"]),
        [cmd] if cmd == "bootstrap" => run("bash", &["scripts/bootstrap/local-dev.sh"]),
        [cmd, action] if cmd == "infra" && action == "up" => {
            run("bash", &["scripts/infrastructure/start-all.sh"])
        }
        [cmd, action] if cmd == "infra" && action == "down" => {
            run("bash", &["scripts/infrastructure/stop-all.sh"])
        }
        [cmd, action] if cmd == "infra" && action == "status" => {
            run("bash", &["scripts/infrastructure/status-all.sh"])
        }
        [cmd, action] if cmd == "chat" && action == "up" => run("bash", &["scripts/chat/start.sh"]),
        [cmd, action] if cmd == "chat" && action == "down" => {
            run("bash", &["scripts/chat/stop.sh"])
        }
        [cmd, action] if cmd == "chat" && action == "status" => {
            run("bash", &["scripts/chat/status.sh"])
        }
        [cmd, action] if cmd == "chat" && action == "smoke" => {
            run("bash", &["scripts/chat/smoke-test.sh"])
        }
        [cmd, action] if cmd == "services" && action == "build" => {
            run("bash", &["scripts/services/build.sh"])
        }
        [cmd, action] if cmd == "services" && action == "start" => {
            run("bash", &["scripts/services/start.sh", "all"])
        }
        [cmd, action, name] if cmd == "services" && action == "start" => {
            run("bash", &["scripts/services/start.sh", name.as_str()])
        }
        [cmd, action] if cmd == "services" && action == "stop" => {
            run("bash", &["scripts/services/stop.sh", "all"])
        }
        [cmd, action, name] if cmd == "services" && action == "stop" => {
            run("bash", &["scripts/services/stop.sh", name.as_str()])
        }
        [cmd, action] if cmd == "services" && action == "status" => {
            run("bash", &["scripts/services/status.sh", "all"])
        }
        [cmd, action, name] if cmd == "services" && action == "status" => {
            run("bash", &["scripts/services/status.sh", name.as_str()])
        }
        [cmd, action] if cmd == "services" && action == "restart" => {
            run("bash", &["scripts/services/restart.sh", "all"])
        }
        [cmd, action, name] if cmd == "services" && action == "restart" => {
            run("bash", &["scripts/services/restart.sh", name.as_str()])
        }
        [cmd, action] if cmd == "linux" && action == "dev" => {
            run("bash", &["scripts/frontend/linux-dev.sh"])
        }
        [cmd, action] if cmd == "linux" && action == "build" => {
            run("pnpm", &["--dir", "frontends/linux", "tauri:build"])
        }
        [cmd, action] if cmd == "linux" && action == "typecheck" => {
            run("pnpm", &["--dir", "frontends/linux", "typecheck"])
        }
        _ => {
            help();
            ExitCode::SUCCESS
        }
    }
}
