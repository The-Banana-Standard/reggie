use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub added_at: String,
    #[serde(default)]
    pub last_opened: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmarks {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default, rename = "allProjectsFolder")]
    pub all_projects_folder: Option<FolderEntry>,
    #[serde(default)]
    pub workspaces: Vec<FolderEntry>,
    #[serde(default)]
    pub projects: Vec<ProjectEntry>,
}

impl Default for Bookmarks {
    fn default() -> Self {
        Self {
            version: 1,
            all_projects_folder: None,
            workspaces: Vec::new(),
            projects: Vec::new(),
        }
    }
}

fn read_bookmarks_from_dir(dir: &Path) -> Result<Bookmarks, String> {
    let path = dir.join("bookmarks.json");
    if !path.exists() {
        return Ok(Bookmarks::default());
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return Err(format!("read bookmarks: {e}")),
    };
    if content.trim().is_empty() {
        return Ok(Bookmarks::default());
    }
    // If JSON is corrupted, return empty defaults rather than crashing the UI.
    Ok(serde_json::from_str::<Bookmarks>(&content).unwrap_or_default())
}

fn write_bookmarks_to_dir(dir: &Path, bookmarks: &Bookmarks) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("create app_data_dir: {e}"))?;
    let path = dir.join("bookmarks.json");
    let tmp = dir.join("bookmarks.json.tmp");
    let json = serde_json::to_string_pretty(bookmarks).map_err(|e| e.to_string())?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_bookmarks(app: AppHandle) -> Result<Bookmarks, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    read_bookmarks_from_dir(&dir)
}

#[tauri::command]
pub fn write_bookmarks(app: AppHandle, bookmarks: Bookmarks) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write_bookmarks_to_dir(&dir, &bookmarks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_folder(id: &str) -> FolderEntry {
        FolderEntry {
            id: id.to_string(),
            name: format!("name-{id}"),
            path: format!("/path/{id}"),
            added_at: "2026-04-25T00:00:00Z".to_string(),
        }
    }

    fn sample_project(id: &str) -> ProjectEntry {
        ProjectEntry {
            id: id.to_string(),
            name: format!("proj-{id}"),
            path: format!("/proj/{id}"),
            added_at: "2026-04-25T00:00:00Z".to_string(),
            last_opened: Some("2026-04-25T01:00:00Z".to_string()),
            workspace_path: Some(format!("/ws/{id}")),
        }
    }

    #[test]
    fn read_missing_file_returns_default() {
        let dir = TempDir::new().unwrap();
        let bm = read_bookmarks_from_dir(dir.path()).unwrap();
        assert_eq!(bm.version, 1);
        assert!(bm.all_projects_folder.is_none());
        assert!(bm.workspaces.is_empty());
        assert!(bm.projects.is_empty());
    }

    #[test]
    fn read_empty_file_returns_default() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bookmarks.json"), b"").unwrap();
        let bm = read_bookmarks_from_dir(dir.path()).unwrap();
        assert_eq!(bm.version, 1);
        assert!(bm.all_projects_folder.is_none());
        assert!(bm.workspaces.is_empty());
        assert!(bm.projects.is_empty());
    }

    #[test]
    fn read_corrupt_json_returns_default() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bookmarks.json"), b"not json{").unwrap();
        let bm = read_bookmarks_from_dir(dir.path()).unwrap();
        assert_eq!(bm.version, 1);
        assert!(bm.all_projects_folder.is_none());
        assert!(bm.workspaces.is_empty());
        assert!(bm.projects.is_empty());
    }

    #[test]
    fn round_trip_preserves_data() {
        let dir = TempDir::new().unwrap();
        let original = Bookmarks {
            version: 1,
            all_projects_folder: Some(sample_folder("all")),
            workspaces: vec![sample_folder("ws1"), sample_folder("ws2")],
            projects: vec![
                sample_project("p1"),
                sample_project("p2"),
                sample_project("p3"),
            ],
        };
        write_bookmarks_to_dir(dir.path(), &original).unwrap();
        let loaded = read_bookmarks_from_dir(dir.path()).unwrap();

        assert_eq!(loaded.version, original.version);
        let lf = loaded.all_projects_folder.unwrap();
        let of = original.all_projects_folder.unwrap();
        assert_eq!(lf.id, of.id);
        assert_eq!(lf.name, of.name);
        assert_eq!(lf.path, of.path);
        assert_eq!(lf.added_at, of.added_at);

        assert_eq!(loaded.workspaces.len(), 2);
        assert_eq!(loaded.workspaces[0].id, "ws1");
        assert_eq!(loaded.workspaces[1].id, "ws2");

        assert_eq!(loaded.projects.len(), 3);
        assert_eq!(loaded.projects[0].id, "p1");
        assert_eq!(loaded.projects[1].id, "p2");
        assert_eq!(loaded.projects[2].id, "p3");
        assert_eq!(loaded.projects[0].last_opened.as_deref(), Some("2026-04-25T01:00:00Z"));
        assert_eq!(loaded.projects[0].workspace_path.as_deref(), Some("/ws/p1"));
    }

    #[test]
    fn atomic_write_leaves_no_tmp() {
        let dir = TempDir::new().unwrap();
        let bm = Bookmarks::default();
        write_bookmarks_to_dir(dir.path(), &bm).unwrap();

        assert!(dir.path().join("bookmarks.json").exists());
        assert!(!dir.path().join("bookmarks.json.tmp").exists());

        // Verify only the expected file exists in the dir.
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], "bookmarks.json");
    }

    #[test]
    fn second_write_overwrites_first() {
        let dir = TempDir::new().unwrap();
        let a = Bookmarks {
            version: 1,
            all_projects_folder: None,
            workspaces: vec![sample_folder("a")],
            projects: vec![],
        };
        let b = Bookmarks {
            version: 1,
            all_projects_folder: None,
            workspaces: vec![sample_folder("b1"), sample_folder("b2")],
            projects: vec![sample_project("bp")],
        };
        write_bookmarks_to_dir(dir.path(), &a).unwrap();
        write_bookmarks_to_dir(dir.path(), &b).unwrap();

        let loaded = read_bookmarks_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.workspaces.len(), 2);
        assert_eq!(loaded.workspaces[0].id, "b1");
        assert_eq!(loaded.workspaces[1].id, "b2");
        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].id, "bp");
    }

    #[test]
    fn serializes_all_projects_folder_as_camel_case() {
        let dir = TempDir::new().unwrap();
        let bm = Bookmarks {
            version: 1,
            all_projects_folder: Some(sample_folder("all")),
            workspaces: vec![],
            projects: vec![],
        };
        write_bookmarks_to_dir(dir.path(), &bm).unwrap();
        let raw = fs::read_to_string(dir.path().join("bookmarks.json")).unwrap();
        assert!(
            raw.contains("\"allProjectsFolder\""),
            "expected camelCase field, got: {raw}"
        );
        assert!(!raw.contains("all_projects_folder"));
    }

    #[test]
    fn partial_json_object_uses_defaults() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bookmarks.json"), b"{}").unwrap();
        let bm = read_bookmarks_from_dir(dir.path()).unwrap();
        assert_eq!(bm.version, 1);
        assert!(bm.all_projects_folder.is_none());
        assert!(bm.workspaces.is_empty());
        assert!(bm.projects.is_empty());
    }
}
