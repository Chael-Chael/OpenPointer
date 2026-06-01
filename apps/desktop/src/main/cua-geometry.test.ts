import { describe, expect, it } from 'vitest';
import type { PointerEntity } from '@openmagicpointer/core';
import {
  displayForRect,
  distanceToRectSquared,
  isNoiseEntity,
  kindFromControlType,
  normalizeRect,
  parseTreeMarkdown,
  resolveHoveredEntity,
  screenRectToLocal,
  type DisplayBounds
} from './cua-geometry.js';

const primary: DisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary: DisplayBounds = { x: 1920, y: 0, width: 1280, height: 720 };

function entity(id: string, bbox: PointerEntity['bbox']): PointerEntity {
  return { id, kind: 'button', text: id, confidence: 0.9, origin: 'accessibility', bbox };
}

describe('normalizeRect', () => {
  it('rejects zero or negative dimensions', () => {
    expect(normalizeRect({ x: 0, y: 0, width: 0, height: 10 })).toBeUndefined();
    expect(normalizeRect({ x: 0, y: 0, width: 10, height: -1 })).toBeUndefined();
  });

  it('rejects non-finite coordinates', () => {
    expect(normalizeRect({ x: NaN, y: 0, width: 10, height: 10 })).toBeUndefined();
  });

  it('coerces numeric strings', () => {
    expect(normalizeRect({ x: '5' as unknown as number, y: 6, width: 10, height: 10 })).toEqual({ x: 5, y: 6, width: 10, height: 10 });
  });
});

describe('distanceToRectSquared', () => {
  it('is zero inside the rect', () => {
    expect(distanceToRectSquared(5, 5, { x: 0, y: 0, width: 10, height: 10 })).toBe(0);
  });

  it('measures squared edge distance outside the rect', () => {
    expect(distanceToRectSquared(13, 5, { x: 0, y: 0, width: 10, height: 10 })).toBe(9);
  });
});

describe('displayForRect', () => {
  it('picks the display with the largest overlap', () => {
    const rect = { x: 1950, y: 100, width: 200, height: 100 };
    expect(displayForRect(rect, [primary, secondary])).toBe(secondary);
  });

  it('falls back to the first display when there is no overlap', () => {
    const rect = { x: 5000, y: 5000, width: 10, height: 10 };
    expect(displayForRect(rect, [primary, secondary])).toBe(primary);
  });

  it('returns undefined when there are no displays', () => {
    expect(displayForRect({ x: 0, y: 0, width: 10, height: 10 }, [])).toBeUndefined();
  });
});

describe('screenRectToLocal', () => {
  it('scales physical pixels to DIPs and subtracts the display origin', () => {
    const physical = { x: 3840, y: 200, width: 100, height: 50 };
    const local = screenRectToLocal(physical, 2, [primary, secondary]);
    // 3840/2 = 1920 -> on secondary display (origin x=1920) -> local x = 0
    expect(local).toEqual({ x: 0, y: 100, width: 50, height: 25 });
  });

  it('treats scale of 1 as DIP coordinates', () => {
    const local = screenRectToLocal({ x: 100, y: 100, width: 40, height: 20 }, 1, [primary]);
    expect(local).toEqual({ x: 100, y: 100, width: 40, height: 20 });
  });

  it('keeps secondary display origins stable under mixed DPI scaling', () => {
    const abovePrimary: DisplayBounds = { id: 3, x: 0, y: -900, width: 1920, height: 900, scaleFactor: 1 };
    const mixedPrimary: DisplayBounds = { id: 1, x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
    const mixedSecondary: DisplayBounds = { id: 2, x: 1920, y: 0, width: 1280, height: 720, scaleFactor: 1.5 };
    const physical = { x: 2070, y: 150, width: 300, height: 60 };
    const local = screenRectToLocal(physical, 1.5, [abovePrimary, mixedPrimary, mixedSecondary], mixedSecondary);
    expect(local).toEqual({ x: 100, y: 100, width: 200, height: 40 });
  });
});

describe('kindFromControlType', () => {
  it('maps common UIA control types', () => {
    expect(kindFromControlType('Edit')).toBe('input');
    expect(kindFromControlType('Hyperlink')).toBe('link');
    expect(kindFromControlType('Button')).toBe('button');
    expect(kindFromControlType('DataGrid')).toBe('table');
    expect(kindFromControlType('Image')).toBe('image');
    expect(kindFromControlType('Unrecognized')).toBe('unknown');
  });

  it('maps richer interactive control types', () => {
    expect(kindFromControlType('CheckBox')).toBe('checkbox');
    expect(kindFromControlType('RadioButton')).toBe('radio');
    expect(kindFromControlType('ComboBox')).toBe('combobox');
    expect(kindFromControlType('MenuItem')).toBe('menuitem');
    expect(kindFromControlType('TabItem')).toBe('tab');
    expect(kindFromControlType('TreeItem')).toBe('treeitem');
    expect(kindFromControlType('ListItem')).toBe('listitem');
    expect(kindFromControlType('Slider')).toBe('slider');
    expect(kindFromControlType('ToolBar')).toBe('toolbar');
  });

  it('maps layout containers to container rather than unknown', () => {
    expect(kindFromControlType('Pane')).toBe('container');
    expect(kindFromControlType('Group')).toBe('container');
    expect(kindFromControlType('Custom')).toBe('container');
  });
});

describe('isNoiseEntity', () => {
  const base = { confidence: 0.9, origin: 'accessibility' as const };
  it('keeps actionable elements even without text', () => {
    expect(isNoiseEntity({ ...base, kind: 'button', groundingRef: { provider: 'cua', pid: 1, windowId: '2', actions: ['invoke'] } })).toBe(false);
  });
  it('keeps elements with a text label', () => {
    expect(isNoiseEntity({ ...base, kind: 'container', text: 'Sidebar' })).toBe(false);
  });
  it('drops empty layout containers and unknowns', () => {
    expect(isNoiseEntity({ ...base, kind: 'container' })).toBe(true);
    expect(isNoiseEntity({ ...base, kind: 'unknown' })).toBe(true);
  });
});

describe('resolveHoveredEntity', () => {
  it('prefers the smallest entity containing the cursor', () => {
    const big = entity('big', { x: 0, y: 0, width: 100, height: 100 });
    const small = entity('small', { x: 10, y: 10, width: 20, height: 20 });
    expect(resolveHoveredEntity({ localX: 15, localY: 15 }, [big, small])).toBe('small');
  });

  it('falls back to the nearest entity within the threshold', () => {
    const near = entity('near', { x: 0, y: 0, width: 10, height: 10 });
    expect(resolveHoveredEntity({ localX: 18, localY: 5 }, [near], 24)).toBe('near');
  });

  it('returns undefined when the nearest entity is beyond the threshold', () => {
    const far = entity('far', { x: 0, y: 0, width: 10, height: 10 });
    expect(resolveHoveredEntity({ localX: 200, localY: 200 }, [far], 24)).toBeUndefined();
  });

  it('ignores entities without a bbox', () => {
    const noBox = entity('nobox', undefined);
    expect(resolveHoveredEntity({ localX: 0, localY: 0 }, [noBox])).toBeUndefined();
  });
});

describe('parseTreeMarkdown', () => {
  // Sample shaped like the real release cua-driver get_window_state output.
  const sample = [
    '- Window "claude"',
    '      - [0] List [id=TabListView actions=[scroll]]',
    '        - [1] TabItem "claude" [actions=[select]]',
    '          - [3] Button "关闭标签页" [id=CloseButton actions=[invoke]]',
    '      - [7] SplitButton "新建标签页" [id=NewTabButton help="打开新选项卡" actions=[invoke,expand]]',
    '        - [9] ScrollBar [id=ScrollBar actions=[set_value]]',
    '  - TitleBar = "claude"',
    '    - [17] Button "关闭" [actions=[invoke]]'
  ].join('\n');

  it('extracts indexed actionable elements', () => {
    const parsed = parseTreeMarkdown(sample);
    expect(parsed.map((e) => e.element_index)).toEqual([0, 1, 3, 7, 9, 17]);
  });

  it('captures control type, name, automation id, help and actions', () => {
    const parsed = parseTreeMarkdown(sample);
    const split = parsed.find((e) => e.element_index === 7)!;
    expect(split.control_type).toBe('SplitButton');
    expect(split.name).toBe('新建标签页');
    expect(split.automation_id).toBe('NewTabButton');
    expect(split.help_text).toBe('打开新选项卡');
    expect(split.actions).toEqual(['invoke', 'expand']);
  });

  it('handles elements without a name', () => {
    const scroll = parseTreeMarkdown(sample).find((e) => e.element_index === 9)!;
    expect(scroll.control_type).toBe('ScrollBar');
    expect(scroll.name).toBeUndefined();
    expect(scroll.automation_id).toBe('ScrollBar');
    expect(scroll.actions).toEqual(['set_value']);
  });

  it('returns an empty array for empty or non-element input', () => {
    expect(parseTreeMarkdown(undefined)).toEqual([]);
    expect(parseTreeMarkdown('- Window "x"\n  - TitleBar = "x"')).toEqual([]);
  });
});
