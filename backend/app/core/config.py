from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    cookie_name: str = "trackline_session"
    cookie_secure: bool = False
    docs_enabled: bool = True
    session_hours: int = 8
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    # Folder that holds uploaded documents. Must already exist. Leave empty to switch uploads off.
    storage_root: str = ""
    max_upload_mb: int = 10
    display_timezone: str = "Asia/Singapore"
    # False (default): an Inventory Manager's changes apply at once, like an admin's. OIC/User changes always wait.
    # True: an Inventory Manager's changes wait for an admin or another manager to approve them.
    managers_need_approval: bool = False


settings = Settings()
