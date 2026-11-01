import type { FormEvent } from "react";
import type { Settings } from "../ui";

type ModelSettingsFormProps = {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  models: string[];
  onSave: (event: FormEvent) => void;
};

export default function ModelSettingsForm({
  settings,
  setSettings,
  models,
  onSave,
}: ModelSettingsFormProps) {
  return (
    <form className="settings-card" onSubmit={onSave}>
      <h2>Models and memory</h2>
      <p>Models run through Ollama on this device.</p>
      <datalist id="models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <label>
        Chat model
        <input
          list="models"
          required
          value={settings.model}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
        />
      </label>
      <label>
        Embedding model
        <input
          list="models"
          required
          value={settings.embedding_model}
          onChange={(e) =>
            setSettings({
              ...settings,
              embedding_model: e.target.value,
            })
          }
        />
      </label>
      <div className="two-col">
        <label>
          Memory limit per response
          <input
            type="number"
            min="1"
            max="50"
            value={settings.memory_limit}
            onChange={(e) =>
              setSettings({
                ...settings,
                memory_limit: +e.target.value,
              })
            }
          />
        </label>
        <label>
          Memory token budget
          <input
            type="number"
            min="100"
            max="8000"
            value={settings.memory_tokens}
            onChange={(e) =>
              setSettings({
                ...settings,
                memory_tokens: +e.target.value,
              })
            }
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.extraction_enabled}
          onChange={(e) =>
            setSettings({
              ...settings,
              extraction_enabled: e.target.checked,
            })
          }
        />
        Extract memories from new messages
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.sensitive_retrieval}
          onChange={(e) =>
            setSettings({
              ...settings,
              sensitive_retrieval: e.target.checked,
            })
          }
        />
        Allow sensitive memories in AI context
      </label>
      <button className="primary">Save settings</button>
    </form>
  );
}
