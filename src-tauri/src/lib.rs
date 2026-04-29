mod commands;
mod installer;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .setup(|app| {
            match installer::run_install(app.handle()) {
                Ok(result) => {
                    eprintln!("[reggie-installer] {}", result.message);
                }
                Err(e) => {
                    eprintln!("[reggie-installer] install failed (non-fatal): {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal::spawn_terminal,
            commands::terminal::write_to_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::check_claude_cli,
            commands::terminal::spawn_headless_terminal,
            commands::terminal::get_terminal_buffer,
            commands::terminal::attach_terminal_channel,
            commands::terminal::write_to_headless_terminal,
            commands::terminal::resize_headless_terminal,
            commands::terminal::close_headless_terminal,
            commands::terminal::get_all_headless_statuses,
            commands::bookmarks::read_bookmarks,
            commands::bookmarks::write_bookmarks,
            commands::pipeline_bindings::get_pipeline_bindings,
            commands::pipeline_bindings::set_pipeline_binding,
            commands::pipeline_bindings::clear_pipeline_binding,
            commands::claude_data::get_sessions_for_project,
            commands::claude_data::read_claude_md,
            commands::projects::scan_workspace,
            commands::projects::scan_all_projects,
            commands::projects::get_project_info,
            commands::claude_data::get_claude_usage_stats,
            commands::skills::get_skills,
            commands::skills::install_skill,
            commands::skills::uninstall_skill,
            commands::skills::check_skills_installed,
            commands::projects::get_parallelizable_tasks,
            commands::projects::scan_tasks_across_repos,
            commands::projects::append_ungroomed_tasks,
            commands::projects::save_attachment_image,
            commands::projects::cleanup_attachments,
            commands::projects::list_orphan_attachments,
            commands::reggie_data::get_agents,
            commands::reggie_data::get_commands,
            commands::reggie_data::get_pipelines,
            commands::run_locally::check_run_script,
            commands::run_locally::open_in_browser,
            commands::git::get_git_log,
            commands::resources::get_resource_dir,
            commands::resources::list_resource_files,
            installer::get_install_status,
            installer::get_detailed_install_status,
            installer::force_reinstall,
            installer::complete_setup,
            installer::add_to_shell_profile,
            installer::get_shell_export_line,
            installer::uninstall_reggie_files,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill all PTY child processes, then drop terminal instances
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut terminals) = state.terminals.lock() {
                        for (_, term) in terminals.iter_mut() {
                            let _ = term.child.kill();
                        }
                        terminals.clear();
                    }
                    // Also clean up headless terminals
                    if let Ok(mut headless) = state.headless_terminals.lock() {
                        for (_, term) in headless.iter_mut() {
                            let _ = term.child.kill();
                        }
                        headless.clear();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
