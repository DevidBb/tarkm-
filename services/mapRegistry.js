// Maps the app can show. Every map runs the same App (quests, places, history, evaluation, LOCATE ME);
// its data files decide floors, markers and which 3D scene is built.

export const MAPS = [
  {
    id: 'streets',
    name: 'Streets of Tarkov',
    nameRu: 'Улицы Таркова',
    mapUrl: 'data/streets.map.json',
    questsUrl: 'data/streets.quests.json',
  },
  {
    id: 'interchange',
    name: 'Interchange',
    nameRu: 'Развязка',
    mapUrl: 'data/interchange/interchange.map.json',
    questsUrl: 'data/interchange/interchange.quests.json',
  },
  {
    id: 'factory',
    name: 'Factory',
    nameRu: 'Завод',
    mapUrl: 'data/factory/factory.map.json',
    questsUrl: 'data/factory/factory.quests.json',
  },
  {
    id: 'customs',
    name: 'Customs',
    nameRu: 'Таможня',
    mapUrl: 'data/customs/customs.map.json',
    questsUrl: 'data/customs/customs.quests.json',
  },
  {
    id: 'shoreline',
    name: 'Shoreline',
    nameRu: 'Берег',
    mapUrl: 'data/shoreline/shoreline.map.json',
    questsUrl: 'data/shoreline/shoreline.quests.json',
  },
];

export const mapDefinition = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
