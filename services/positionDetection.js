// "Where am I?" pipeline.
// 1. EFT screenshot file name -> exact game coordinates (confidence 100%).
// 2. Otherwise Claude looks at the image and ranks places from the catalog.
//    Below CONFIDENCE_THRESHOLD the result is only a list of possible places - no position is placed.

import { parseEftScreenshotName, forwardFromQuaternion } from './eftScreenshot.js';

export const CONFIDENCE_THRESHOLD = 0.5;

export async function detectPosition({ file, fileName, mapData, vision, signal, onStep, onText }) {
  if (onStep) onStep('filename');
  const parsed = parseEftScreenshotName(fileName);
  if (parsed) {
    const { position } = parsed;
    if (!mapData.projection.isInside(position)) {
      return { status: 'out_of_bounds', method: 'filename', position, takenAt: parsed.takenAt };
    }
    const near = mapData.nearest(position, { types: ['place', 'extract', 'trader', 'transit'], limit: 1 })[0] || null;
    return {
      status: 'found',
      method: 'filename',
      confidence: 1,
      approximate: false,
      position,
      floor: mapData.floorAt(position),
      forward: forwardFromQuaternion(parsed.rotation),
      place: near ? near.entity : null,
      placeMeters: near ? near.meters : null,
      takenAt: parsed.takenAt,
    };
  }

  if (!vision || !vision.available) {
    return { status: 'ai_unavailable', method: 'ai', message: vision ? vision.message : null };
  }

  if (onStep) onStep('ai');
  const ai = await vision.analyze(file, mapData.aiCatalog, {
    signal,
    onText,
    mapName: mapData.map.name || 'Streets of Tarkov',
    floorIds: mapData.levels ? mapData.floors.map((f) => f.id) : undefined,
  });
  if (ai.isStreets === false) return { status: 'not_streets', method: 'ai', ai };
  const top = ai.candidates[0];
  if (!top) return { status: 'not_found', method: 'ai', ai };
  if (top.confidence < CONFIDENCE_THRESHOLD) return { status: 'uncertain', method: 'ai', ai };
  return foundFromCandidate(top, ai, 'ai');
}

// Also used when the player confirms one of the uncertain candidates themselves.
export function foundFromCandidate(candidate, ai, method = 'ai_confirmed') {
  const { place } = candidate;
  return {
    status: 'found',
    method,
    confidence: candidate.confidence,
    approximate: true,
    position: { x: place.position.x, y: place.position.y, z: place.position.z },
    floor: candidate.floor || place.floor || null,
    forward: null,
    place,
    placeMeters: null,
    takenAt: null,
    ai,
  };
}

// Plain JSON for storage (no entity objects).
export function toPositionRecord(result, fileName) {
  return {
    createdAt: new Date().toISOString(),
    method: result.method,
    confidence: result.confidence,
    approximate: result.approximate,
    placeId: result.place ? result.place.id : null,
    placeName: result.place ? result.place.nameRu || result.place.name : null,
    placeMeters: result.placeMeters,
    floor: result.floor,
    x: result.position.x,
    y: result.position.y,
    z: result.position.z,
    forwardX: result.forward ? result.forward.x : null,
    forwardZ: result.forward ? result.forward.z : null,
    takenAt: result.takenAt || null,
    fileName: fileName || null,
  };
}

// Stored record -> result shape the map understands.
export function resultFromRecord(record, mapData) {
  return {
    status: 'found',
    method: record.method,
    confidence: record.confidence,
    approximate: record.approximate,
    position: { x: record.x, y: record.y, z: record.z },
    floor: record.floor,
    forward: record.forwardX == null ? null : { x: record.forwardX, z: record.forwardZ },
    place: record.placeId ? mapData.byId.get(record.placeId) || null : null,
    placeMeters: record.placeMeters,
    takenAt: record.takenAt,
    recordId: record.id,
  };
}
