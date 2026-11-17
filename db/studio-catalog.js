'use strict';
/**
 * How the Earthwork Takeoff Studio files become projects.
 *
 * Alamo base and the east alternate are ONE project with two scenarios (base and alternate).
 * They are the same Phase 7 streetscape, two plan sheets, two grids.
 *
 * Innovation is ONE project with three scenarios. The files name one job at 1222 Kelly Pkwy.
 * innovation.json is the Phases 2 and 3 model. innovation_p2.json and innovation_p3.json
 * are the Phase 2 and Phase 3 grids. There is no phase 1 file in this set.
 *
 * data.json is Building 820 Parking Lot at Brooks City Base (its `name` field). The filename
 * is historical; it is not a second copy of another job.
 *
 * Buc-ee's grid attaches to the existing sample project (ce08cc827c). It does not create
 * a second project and it does not touch the $18,405,662.10 bid.
 */

const BUCEES_PROJECT_ID = 'ce08cc827c';

const INNOVATION_REF_FLAG = 'reference.cut_cy and reference.fill_cy are the same numbers on the Phases 2 and 3 file and on the phase 2 and phase 3 files; they are stored as written and may describe the overall model rather than this grid alone';

const STUDIO_JOBS = [
  {
    key: 'brooks',
    file: 'data.json',
    projectId: 'proj-brooks-820',
    projectName: 'Building 820 Parking Lot - Brooks City Base',
    location: null,
    versionId: 'ew-brooks',
    scenarioKey: 'brooks',
    scenarioRole: 'site',
    sort: 0,
    aerial: 'data_aerial.png',
    grading: null,
    projectFlags: ['city is not stated beyond the name Brooks City Base', 'region left null; TX-HEB is the rate library, not this job'],
  },
  {
    key: 'bucees',
    file: 'bucees.json',
    projectId: BUCEES_PROJECT_ID,
    attachExisting: true,
    versionId: 'ew-bucees',
    scenarioKey: 'bucees',
    scenarioRole: 'site',
    sort: 1,
    aerial: 'bucees_aerial.png',
    grading: null,
    projectFlags: [],
  },
  {
    key: 'va',
    file: 'va.json',
    projectId: 'proj-va-cboc',
    projectName: 'VA CBOC San Marcos TX (Crystal River)',
    location: null,
    versionId: 'ew-va',
    scenarioKey: 'va',
    scenarioRole: 'site',
    sort: 2,
    aerial: null,
    grading: null,
    projectFlags: ['place is only what the job name says: San Marcos TX (Crystal River)', 'no aerial file shipped with this job'],
  },
  {
    key: 'dunant',
    file: 'dunant.json',
    projectId: 'proj-dunant',
    projectName: 'McKinney Dunant Union',
    location: '7201 Dunant Way, Austin TX',
    versionId: 'ew-dunant',
    scenarioKey: 'dunant',
    scenarioRole: 'site',
    sort: 3,
    aerial: 'dunant_aerial.png',
    grading: 'dunant_grading.png',
    projectFlags: ['phase names are in the grid; per-phase cut and fill are not in the file'],
  },
  {
    key: 'alamo-base',
    file: 'alamo_base.json',
    projectId: 'proj-alamo-church-p7',
    projectName: 'Alamo Church Phase 7',
    location: null,
    versionId: 'ew-alamo-base',
    scenarioKey: 'base',
    scenarioRole: 'base',
    sort: 4,
    aerial: null,
    grading: 'alamo_base_grading.png',
    projectFlags: ['city is not in the job file; the sheet is E. Houston St west', 'base and east alternate are two scenarios on this one project'],
  },
  {
    key: 'alamo-alt',
    file: 'alamo_alt.json',
    projectId: 'proj-alamo-church-p7',
    versionId: 'ew-alamo-alt',
    scenarioKey: 'alternate',
    scenarioRole: 'alternate',
    sort: 5,
    aerial: null,
    grading: 'alamo_alt_grading.png',
    projectFlags: [],
    extraFlags: ['east add alternate (sheet C3.10) on Alamo Church Phase 7'],
  },
  {
    key: 'innovation-phases',
    file: 'innovation.json',
    projectId: 'proj-innovation-b2',
    projectName: 'Innovation Building #2 - Innovation Industrial Park',
    location: '1222 Kelly Pkwy, San Antonio TX',
    versionId: 'ew-innovation-phases',
    scenarioKey: 'phases-2-3',
    scenarioRole: 'site',
    sort: 6,
    aerial: 'innovation_aerial.png',
    grading: 'innovation_grading.png',
    projectFlags: ['one project for the three Innovation grids', 'no phase 1 file is in this set'],
    extraFlags: [INNOVATION_REF_FLAG],
  },
  {
    key: 'innovation-p2',
    file: 'innovation_p2.json',
    projectId: 'proj-innovation-b2',
    versionId: 'ew-innovation-p2',
    scenarioKey: 'phase-2',
    scenarioRole: 'phase',
    sort: 7,
    aerial: 'innovation_p2_aerial.png',
    grading: 'innovation_p2_grading.png',
    extraFlags: [INNOVATION_REF_FLAG, 'grid is Phase 2 (Buildings 1-3)'],
  },
  {
    key: 'innovation-p3',
    file: 'innovation_p3.json',
    projectId: 'proj-innovation-b2',
    versionId: 'ew-innovation-p3',
    scenarioKey: 'phase-3',
    scenarioRole: 'phase',
    sort: 8,
    aerial: 'innovation_p3_aerial.png',
    grading: 'innovation_p3_grading.png',
    extraFlags: [INNOVATION_REF_FLAG, 'grid is Phase 3 (Buildings 4-7)'],
  },
];

module.exports = { STUDIO_JOBS, BUCEES_PROJECT_ID, INNOVATION_REF_FLAG };
