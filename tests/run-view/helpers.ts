// Shared setup for the run-view tests: a sample session and a complete setup with a fire.
import { FIRE_LIBRARY } from '../../src/core/fire/library';
import { loadSample, type PlanSession, type SampleId } from '../../src/web/home/sampleConfigs';
import type { SetupState } from '../../src/web/setup/scenarioBuilder';
import { defaultSetup } from '../../src/web/setup/setupScreen';

export function sampleSetup(id: SampleId, durationS = 60, itemId = 'sofa'): { session: PlanSession; state: SetupState } {
  const session = loadSample(id);
  const room = session.result.model!.rooms.find((r) => r.kind === 'room')!;
  const state: SetupState = { ...defaultSetup(session), fireRoomId: room.id, fireChoice: FIRE_LIBRARY.find((f) => f.id === itemId)!, durationS };
  return { session, state };
}
