type AppHeaderProps = {
  title: string;
  theme: "dark" | "light";
  model?: string;
  onToggleTheme: () => void;
};

export default function AppHeader({
  title,
  theme,
  model,
  onToggleTheme,
}: AppHeaderProps) {
  return (
    <header>
      <h1 className="page-title">{title}</h1>
      <div className="header-right">
        <button
          className="theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        <span className="model-pill">◈ {model || "Local model"}</span>
      </div>
    </header>
  );
}
