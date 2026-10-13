CREATE TABLE IF NOT EXISTS managed_repos(repo_id TEXT PRIMARY KEY,scope_type TEXT NOT NULL,scope_key TEXT NOT NULL,path TEXT NOT NULL,default_agent TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(scope_type,scope_key));
INSERT OR IGNORE INTO schema_migrations VALUES(2,unixepoch()*1000);
