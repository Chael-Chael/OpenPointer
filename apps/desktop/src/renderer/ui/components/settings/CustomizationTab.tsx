import type { AppSettings } from '@openpointer/storage';
import { NumberSlider } from '../fields';

type CustomizationTabProps = {
  settings: AppSettings;
  pillWidth: number;
  pillHeight: number;
  updateSettings(patch: Partial<AppSettings>): void;
};

export function CustomizationTab({ settings, pillWidth, pillHeight, updateSettings }: CustomizationTabProps) {
  return (
    <>
      <section className="settings-section">
        <label className="field">
          <span>Interface theme</span>
          <select
            value={settings.modalTheme ?? 'blue'}
            onChange={(event) => updateSettings({ modalTheme: event.target.value as AppSettings['modalTheme'] })}
          >
            <option value="blue">Blue (default)</option>
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <label className="field">
          <span>Background process corner</span>
          <select
            value={settings.backgroundProcessCorner ?? 'bottom-left'}
            onChange={(event) => updateSettings({ backgroundProcessCorner: event.target.value as AppSettings['backgroundProcessCorner'] })}
          >
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <label className="field">
          <span>New dialog behavior</span>
          <select
            value={settings?.newDialogBehavior ?? 'continue'}
            onChange={(event) => updateSettings({ newDialogBehavior: event.target.value as AppSettings['newDialogBehavior'] })}
          >
            <option value="new">Always start a new conversation</option>
            <option value="continue">Always continue the previous conversation</option>
            <option value="interval">Start new conversation after interval, otherwise continue</option>
          </select>
        </label>
        {(settings?.newDialogBehavior ?? 'continue') === 'interval' && (
          <div className="mt-3">
            <NumberSlider
              label="New dialog interval"
              value={settings?.newDialogInterval ?? 300}
              min={10}
              max={3600}
              step={10}
              unit="s"
              onChange={(value) => updateSettings({ newDialogInterval: value })}
            />
          </div>
        )}
      </section>

      <section className="settings-section grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <NumberSlider
          label="Pill width"
          value={pillWidth}
          min={240}
          max={900}
          step={10}
          unit="px"
          onChange={(value) => updateSettings({ pillWidth: value })}
        />
        <NumberSlider
          label="Pill height"
          value={pillHeight}
          min={24}
          max={96}
          step={2}
          unit="px"
          onChange={(value) => updateSettings({ pillHeight: value })}
        />
      </section>
    </>
  );
}
