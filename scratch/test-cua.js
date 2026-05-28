import { CuaSidecarManager } from '../apps/desktop/dist/main/cua-sidecar.js';
import path from 'path';

async function test() {
  const manager = new CuaSidecarManager(path.resolve('.'));
  try {
    const windows = await manager.callTool('list_windows');
    console.log(JSON.stringify(windows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    manager.stop();
  }
}
test();
