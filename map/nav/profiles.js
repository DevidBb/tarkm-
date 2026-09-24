// Walking profiles of the maps: how the groups of each SVG plan read as walking roles, which floors make up the
// street level (the ground outside plus the ground floor inside buildings) and map specific extras.
//
// Roles:
//   walk / forest / road   - open ground (road: preferred like a navigator prefers roads; forest: cover)
//   water / rock           - not walkable (drawn in document order, so a road or pier drawn over water is a bridge)
//   building               - footprint; with a floor plan inside it is entered through the doorways of the plan,
//                            without one (soft buildings) it is walkable at a detour cost ("the entrance is not drawn")
//   block                  - solid obstacle (walls, machinery, power-line towers)
//   fence / border         - barrier lines
//   mines / hazard         - minefields always block; sniper zones only cost extra
//   room / stairs          - floor plans of the storeys; stairs join neighbouring storeys
//   passage                - open walkable parts of a storey (tunnels, galleries, ramps)
//   ignore / recurse       - skip, or sort the subgroups one by one

const DEFAULT = {
  cell: 0.6,
  street: ['OUTSIDE', 'LEVEL1'], // floors drawn on the street layer
  soft: true, // buildings without a floor plan can be entered (at a cost)
  border: true, // the map border line blocks
  roles: {},
};

export const NAV_PROFILES = {
  'streets-of-tarkov': { cell: 0.5, street: ['GROUND', '1F'], soft: false, border: false },
  customs: { cell: 0.6, street: ['OUTSIDE', 'LEVEL1'] },
  shoreline: { cell: 0.9, street: ['OUTSIDE', 'LEVEL1'], roles: { Buildings: 'recurse' } },
  interchange: {
    cell: 0.8,
    street: ['STREET', 'PARKING'],
    soft: false,
    roles: { Pavement: 'recurse', Outdoors: 'road', Garage: 'room', Structure: 'building', 'Structure-1': 'ignore', 'Structure-2': 'ignore' },
    portals: 'interchange',
  },
  factory: {
    cell: 0.35,
    street: ['OUTSIDE', 'LEVEL1'],
    soft: false,
    border: false,
    roles: { Obstacles: 'block', 'Obstacles-2': 'block', Wall: 'block', 'Wall-2': 'block', 'Wall-3': 'block', 'Wall-b': 'block', Building: 'block' },
  },
  woods: { cell: 1.0, street: ['OUTSIDE', 'LEVEL1'], roles: { Plane: 'block', Pier: 'road' } },
  reserve: { cell: 0.8, street: ['OUTSIDE', 'LEVEL1'], roles: { Misc: 'block', Bunker_entr: 'building' } },
  lighthouse: { cell: 1.0, street: ['OUTSIDE', 'LEVEL1'] },
  'ground-zero': { cell: 0.5, street: ['GROUND', 'LEVEL1', '1F'], roles: { Roofs: 'ignore', Fountain: 'water' } },
  terminal: { cell: 0.9, street: ['OUTSIDE', 'LEVEL1'], roles: { Buildings: 'recurse', Unacessible: 'block' } },
  labs: { cell: 0.4, street: ['LEVEL1'], soft: false, border: false },
};

export function navProfile(mapData) {
  const id = mapData.map.id;
  return { ...DEFAULT, ...(NAV_PROFILES[id] || NAV_PROFILES[mapData.kind] || {}), id };
}

const ROAD_CLASSES = ['cement', 'tarmac', 'gravel', 'wood', 'road_tarmac', 'road_gravel'];
const IGNORE_CLASSES = ['powerline', 'plane', 'task', 'misc', 'shadow_only'];

// Role of a group from its id and classes (own + inherited). onStreet: the group belongs to the street layer's
// main floor (the open ground); on other floors open ground reads as a passage.
export function roleOf(profile, id, classes, { ground }) {
  const override = profile.roles[id];
  if (override) return override;
  const has = (c) => classes.includes(c);
  if (/tower/i.test(id)) return 'block';
  if (has('stairs')) return 'stairs';
  if (has('floor') || has('locked')) return 'room';
  if (has('danger_small') || (has('danger') && /mine/i.test(id))) return 'mines';
  if (has('danger')) return 'hazard';
  if (has('water')) return 'water';
  if (has('rock')) return ground ? 'rock' : 'block';
  if (has('map_border')) return 'border';
  if (has('fence')) return 'fence';
  if (has('wall')) return 'block';
  if (has('building') || has('structure')) return ground ? 'building' : 'block';
  if (has('trees')) return ground ? 'forest' : 'ignore';
  if (has('land') || has('railroad')) return ground ? 'walk' : 'passage';
  if (ROAD_CLASSES.some(has)) return ground ? 'road' : 'passage';
  if (IGNORE_CLASSES.some(has)) return 'ignore';
  if (!classes.length || classes.every((c) => c === 'shadow')) return 'recurse';
  return 'ignore';
}
