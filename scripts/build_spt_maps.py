"""Map data for the maps tarkov.dev data could not be downloaded for yet (Woods, Reserve, Lighthouse, Ground Zero).

Sources (all open):
- SVG plans: github.com/the-hideout/tarkov-dev-svg-maps (Shebuka, CC BY-NC-SA 4.0)
- map config (bounds, labels): github.com/the-hideout/tarkov-dev src/data/maps.json
- game data: github.com/sp-tarkov/server project/assets/database (spawn points, boss zones, quests, Russian locale)

What this gives: the plan, place labels, PMC spawns, scav and boss spawn zones, the relief from spawn heights, and the
quests of the map (text only - SPT has no quest zone coordinates). Extract points, keys, loot containers and quest
points come from tarkov.dev (json.tarkov.dev); re-run the tarkov.dev import when that host is reachable.

Usage: python3 scripts/build_spt_maps.py <tarkov-dev-svg-maps dir> <tarkov-dev repo dir> <sp-tarkov server dir> <app dir>
"""

import json
import math
import os
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone

SVG_DIR, TDEV_DIR, SPT_DIR, APP_DIR = sys.argv[1:5]
DB = os.path.join(SPT_DIR, 'project/assets/database')

MAPS = {
    'woods': dict(spt='woods', key='woods', svg='Woods.svg', name='Woods', nameRu='Лес', gameId='5704e3c2d2720bac5b8b4567'),
    'reserve': dict(spt='rezervbase', key='reserve', svg='Reserve.svg', name='Reserve', nameRu='Резерв', gameId='5704e5fad2720bc05b8b4567'),
    'lighthouse': dict(spt='lighthouse', key='lighthouse', svg='Lighthouse.svg', name='Lighthouse', nameRu='Маяк', gameId='5704e4dad2720bb55b8b4567'),
    'ground-zero': dict(spt='sandbox', key='ground-zero', svg='GroundZero.svg', name='Ground Zero', nameRu='Эпицентр', gameId='653e6760052c01c1c805532f'),
}

# Place labels of tarkov.dev maps in Russian (the names players use in the Russian game client).
LABELS_RU = {
    'Sawmill': 'Лесопилка', 'Scav Town': 'Деревня диких', 'Old Sawmill': 'Старая лесопилка', 'Cultist Village': 'Деревня культистов',
    'USEC Camp': 'Лагерь USEC', 'Military Camp': 'Военный лагерь', 'Ponds': 'Пруды', 'Crash Site': 'Место крушения',
    'Checkpoint': 'КПП', 'Shack': 'Хижина', 'Lumber': 'Бревна', 'Cabins': 'Домики', 'Bus Stop': 'Автобусная остановка',
    "Jaeger's Camp": 'Лагерь Егеря', 'Sniper Rock': 'Снайперская скала', 'Convoy': 'Конвой',
    'Dome': 'Купол', 'Pawns': 'Пешки', 'Black Bishop': 'Черный слон', 'White Bishop': 'Белый слон', 'White King': 'Белый король',
    'Black Knight': 'Черный конь', 'White Knight': 'Белый конь', 'Knights': 'Кони', 'Train Depot': 'Ж/д депо', 'Scav Lands': 'Земли диких',
    'Black Pawn': 'Черная пешка', 'White Pawn': 'Белая пешка', 'Queen': 'Ферзь', 'Barracks': 'Казармы', 'Hangars': 'Ангары',
    'Garages': 'Гаражи', 'Helicopter': 'Вертолет', 'Bunker': 'Бункер', 'Drop-down': 'Спуск', 'Fire Station': 'Пожарная часть',
    'Water Treatment Plant': 'Очистные сооружения', 'Water Treatment': 'Очистные сооружения', 'Lighthouse': 'Маяк', 'Chalets': 'Шале',
    'Rogue Camp': 'Лагерь разбойников', 'Village': 'Поселок', 'Trailer Park': 'Трейлерный парк', 'Train Yard': 'Ж/д станция',
    'Hillside Houses': 'Дома на холме', 'Mountain Village': 'Горная деревня', 'Island': 'Остров', 'Sunken Village': 'Затопленная деревня',
    'Mansion': 'Особняк', 'Merin car': 'Машина «Мерин»', 'Road to Military Base': 'Дорога к военной базе', 'Radio Station': 'Радиостанция',
    'Emercom': 'МЧС', 'Nakatani Basement': 'Подвал Накатани', 'Nakatani': 'Накатани', 'TerraGroup': 'TerraGroup', 'Capital Insight': 'Capital Insight',
    'Unity Credit Bank': 'Банк Unity Credit', 'Mira Ave.': 'Проспект Мира', 'Underground Parking': 'Подземная парковка', 'Scav Camp': 'Лагерь диких',
    'Construction': 'Стройка', 'Checkpoint A': 'КПП А', 'Hospital': 'Больница', 'Shoreline Path': 'Тропа к Берегу', 'Tunnel': 'Туннель',
    'Collapsed Tunnel': 'Обвалившийся туннель', 'Abandoned Village': 'Заброшенная деревня', 'Cottages': 'Коттеджи', 'Pier': 'Пирс',
    'Railroad Bridge': 'Ж/д мост', 'Airfield': 'Аэродром', 'Command Bunker': 'Командный бункер', 'Swimming Pool': 'Бассейн',
    'Warehouses': 'Склады', 'Storage': 'Склад', 'Checkpoint Fence Tower': 'Вышка у КПП',
}

BOSSES = {
    'bossGluhar': ('Glukhar', 'Глухарь'), 'bossKojaniy': ('Shturman', 'Штурман'), 'bossZryachiy': ('Zryachiy', 'Зрячий'),
    'bossKnight': ('The Goons', 'Отступники'), 'bossPartisan': ('Partisan', 'Партизан'), 'bossKilla': ('Killa', 'Килла'),
    'bossTagilla': ('Tagilla', 'Тагилла'), 'sectantPriest': ('Cultists', 'Культисты'), 'pmcBot': ('Raiders', 'Рейдеры'),
    'exUsec': ('Rogues', 'Разбойники'), 'bossBoar': ('Kaban', 'Кабан'), 'bossKolontay': ('Kollontay', 'Коллонтай'), 'bossSanitar': ('Sanitar', 'Санитар'),
}

TRADERS = {
    '54cb50c76803fa8b248b4571': ('Prapor', 'Прапор'), '54cb57776803fa99248b456e': ('Therapist', 'Терапевт'), '58330581ace78e27b8b10cee': ('Skier', 'Лыжник'),
    '5935c25fb3acc3127c3d8cd9': ('Peacekeeper', 'Миротворец'), '5a7c2eca46aef81a7ca2145d': ('Mechanic', 'Механик'), '5ac3b934156ae10c4430e83c': ('Ragman', 'Барахольщик'),
    '5c0647fdd443bc2504c2d371': ('Jaeger', 'Егерь'), '579dc571d53a0658a154fbec': ('Fence', 'Скупщик'), '638f541a29ffd1183d187f57': ('Lightkeeper', 'Смотритель'),
    '656f0f98d80a697f855d34b1': ('BTR Driver', 'Водитель БТР'), '6617beeaa9cfa777ca915b7c': ('Ref', 'Реф'),
}

# Extract keys the locale has no text for.
EXITS_RU = {
    'Factory Gate': 'Ворота на Завод (Совм.)', 'EXFIL_Bunker_D2': 'Гермозатвор бункера D-2', 'tunnel_shared': 'Боковой тоннель (Совм.)',
    'Coastal_South_Road': 'Южная прибрежная дорога', 'V-Ex_light': 'А-Выход на дороге',
}

OBJECTIVE_TYPE = {
    'FindItem': 'findItem', 'HandoverItem': 'giveItem', 'CounterCreator': 'visit', 'LeaveItemAtLocation': 'plantItem', 'PlaceBeacon': 'mark',
    'WeaponAssembly': 'buildWeapon', 'Skill': 'skill', 'TraderLoyalty': 'traderLevel', 'Quest': 'taskStatus', 'SellItemToTrader': 'sellItem',
}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def svg_size(path):
    import re
    head = open(path, encoding='utf-8').read(3000)
    vb = re.search(r'viewBox="([^"]+)"', head).group(1).split()
    return float(vb[2]), float(vb[3])


def median(v):
    s = sorted(v)
    return s[len(s) // 2] if s else 0.0


def main():
    ru = load(os.path.join(DB, 'locales/global/ru.json'))
    en = load(os.path.join(DB, 'locales/global/en.json'))
    quests_db = load(os.path.join(DB, 'templates/quests.json'))
    tdev = load(os.path.join(TDEV_DIR, 'src/data/maps.json'))
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for map_id, cfg in MAPS.items():
        out_dir = os.path.join(APP_DIR, 'data', map_id)
        os.makedirs(out_dir, exist_ok=True)
        shutil.copy(os.path.join(SVG_DIR, cfg['svg']), os.path.join(out_dir, cfg['svg']))
        W, H = svg_size(os.path.join(SVG_DIR, cfg['svg']))
        group = next(g for g in tdev if g['normalizedName'] == cfg['key'])
        tm = group['maps'][0]
        b = tm.get('svgBounds') or tm['bounds']
        bounds = {'topLeft': {'x': b[0][0], 'z': b[0][1]}, 'bottomRight': {'x': b[1][0], 'z': b[1][1]}}
        base = load(os.path.join(DB, 'locations', cfg['spt'], 'base.json'))

        # spawn points: PMC spawns as markers; every point's height feeds the relief
        markers = []
        samples = []
        zones = defaultdict(list)
        n_pmc = 0
        for sp in base['SpawnPointParams']:
            p = sp['Position']
            pos = {'x': round(p['x'], 2), 'y': round(p['y'], 2), 'z': round(p['z'], 2)}
            if abs(pos['x']) < 0.01 and abs(pos['z']) < 0.01:
                continue
            samples.append([pos['x'], pos['y'], pos['z']])
            cats = sp.get('Categories') or []
            sides = [s.lower() for s in (sp.get('Sides') or [])]
            if 'Player' in cats and ('pmc' in sides or 'all' in sides):
                n_pmc += 1
                markers.append({
                    'id': f'spawn-pmc-{n_pmc}', 'type': 'spawn', 'name': 'PMC spawn', 'nameRu': 'Спавн ЧВК', 'position': pos, 'floor': 'OUTSIDE',
                    'meta': {'sides': 'all' if 'all' in sides else 'pmc', 'zone': sp.get('Id'), 'zoneName': sp.get('BotZoneName') or None, 'zoneNameRu': None},
                })
            if sp.get('BotZoneName'):
                zones[sp['BotZoneName']].append(pos)

        # bosses: every zone a boss can spawn in, at the centre of that zone's spawn points
        seen = set()
        for bs in base.get('BossLocationSpawn', []):
            mob = bs['BossName']
            if mob not in BOSSES or not bs.get('BossZone'):
                continue
            zone_list = [z for z in bs['BossZone'].split(',') if z]
            for zone in zone_list:
                pts = zones.get(zone)
                if not pts or (mob, zone) in seen:
                    continue
                seen.add((mob, zone))
                c = {k: round(sum(q[k] for q in pts) / len(pts), 2) for k in 'xyz'}
                name, name_ru = BOSSES[mob]
                pretty = zone.replace('Zone', '').replace('_', ' ').strip()
                markers.append({
                    'id': f'boss-{mob.lower()}-{zone.lower()}', 'type': 'boss', 'name': name, 'nameRu': name_ru, 'position': c, 'floor': 'OUTSIDE',
                    'meta': {'mob': mob, 'zone': zone, 'zoneName': pretty, 'zoneNameRu': None, 'spawnChance': round(bs.get('BossChance', 0) / 100, 2),
                             'locationChance': round(1 / len(zone_list), 2), 'positions': pts[:40]},
                })

        # place labels
        locations = []
        for k, lab in enumerate(tm.get('labels', [])):
            text = lab['text']
            locations.append({
                'id': f"{text.lower().replace(' ', '-').replace('.', '').replace(chr(39), '')}-{k}", 'name': text, 'nameRu': LABELS_RU.get(text),
                'kind': 'place', 'position': {'x': lab['position'][0], 'y': None, 'z': lab['position'][1]}, 'floor': 'OUTSIDE', 'source': 'tarkov.dev map labels',
            })

        ground = median([s[1] for s in samples])
        exits = [{'key': e['Name'].strip(), 'nameRu': EXITS_RU.get(e['Name'].strip()) or ru.get(e['Name']) or e['Name'].strip(), 'name': en.get(e['Name']) or e['Name'].strip(), 'chance': e.get('Chance')} for e in base.get('exits', [])]
        data = {
            'format': 'tarkov-map-ai/map@1', 'generatedAt': now,
            'sources': [
                {'name': 'SPT server database (spawn points, boss zones)', 'url': 'https://github.com/sp-tarkov/server', 'license': 'NCSA'},
                {'name': f"{cfg['name']} SVG map (Shebuka)", 'url': 'https://github.com/the-hideout/tarkov-dev-svg-maps', 'license': 'CC BY-NC-SA 4.0'},
                {'name': 'tarkov.dev map config (bounds, labels)', 'url': 'https://github.com/the-hideout/tarkov-dev', 'license': 'GPL-3.0'},
            ],
            'map': {
                'id': map_id, 'kind': 'open', 'gameId': cfg['gameId'], 'name': cfg['name'], 'nameRu': cfg['nameRu'],
                'svg': {'file': f"{map_id}/{cfg['svg']}", 'width': W, 'height': H, 'buildingsGroup': 'Buildings', 'author': 'Shebuka', 'license': 'CC BY-NC-SA 4.0'},
                'bounds': bounds, 'coordinateRotation': tm.get('coordinateRotation', 180), 'environmentFile': f'{map_id}/{map_id}.environment.json',
                'partialData': {'missing': ['extract', 'key', 'loot', 'questPoints'], 'exits': exits},
            },
            'levels': {'defaultFloor': 'OUTSIDE', 'order': ['OUTSIDE'], 'groups': [{'id': 'outside', 'name': 'Outside', 'nameRu': 'Вся территория', 'floors': ['OUTSIDE']}], 'source': 'single level'},
            'floors': [{'id': 'OUTSIDE', 'name': 'Outside', 'nameRu': 'Вся территория', 'group': 'outside', 'svgLayer': 'Ground_Level', 'minY': None, 'maxY': None, 'displayY': round(ground, 1)}],
            'locations': locations,
            'markers': markers,
            'loot': {'source': 'none yet', 'containerTypes': [], 'items': {}, 'containers': [], 'loose': []},
            'terrain': {'source': 'heights of SPT spawn points', 'samples': samples},
        }
        with open(os.path.join(out_dir, f'{map_id}.map.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        env = {'format': 'tarkov-map-ai/environment@1', 'generatedAt': now, 'source': 'none yet', 'vehicles': [], 'roofPoints': [], 'emplacements': [], 'minefields': [], 'checkpoints': [], 'manholes': [], 'parkingLots': [], 'btrStops': []}
        with open(os.path.join(out_dir, f'{map_id}.environment.json'), 'w', encoding='utf-8') as f:
            json.dump(env, f, ensure_ascii=False)

        # quests of this map: names and objective texts from the Russian / English game locale, no map points
        quests = []
        traders = {}
        for q in quests_db.values():
            if q.get('location') != cfg['gameId']:
                continue
            qid = q['_id']
            tid = q.get('traderId')
            if tid in TRADERS:
                traders[tid] = {'id': tid, 'name': TRADERS[tid][0], 'nameRu': TRADERS[tid][1]}
            objectives = []
            for c in q.get('conditions', {}).get('AvailableForFinish', []):
                cid = c['id']
                text_en = en.get(cid)
                text_ru = ru.get(cid)
                if not text_en and not text_ru:
                    continue
                objectives.append({
                    'id': cid, 'type': OBJECTIVE_TYPE.get(c.get('conditionType'), 'other'), 'description': text_en, 'descriptionRu': text_ru,
                    'optional': bool(c.get('parentId')), 'onMap': False, 'count': c.get('value') if isinstance(c.get('value'), (int, float)) else 1,
                    'foundInRaid': bool(c.get('onlyFoundInRaid')), 'questItem': None, 'items': [], 'itemsTotal': 0, 'markerItem': None, 'weapons': [],
                    'weaponsTotal': 0, 'requiredKeys': [], 'exitName': None, 'targetNames': [], 'zoneNames': [], 'points': [],
                })
            name_en = en.get(f'{qid} name') or q.get('QuestName')
            quests.append({
                'id': qid, 'name': name_en, 'nameRu': ru.get(f'{qid} name'), 'normalizedName': (name_en or qid).lower().replace(' ', '-'), 'traderId': tid,
                'wikiLink': None, 'minPlayerLevel': 0, 'kappaRequired': False, 'lightkeeperRequired': tid == '638f541a29ffd1183d187f57', 'neededKeys': [],
                'objectives': objectives,
            })
        qdata = {'format': 'tarkov-map-ai/quests@1', 'generatedAt': now, 'mapId': cfg['gameId'],
                 'source': {'name': 'SPT server database (quest texts; no quest zone coordinates)', 'url': 'https://github.com/sp-tarkov/server'},
                 'traders': sorted(traders.values(), key=lambda t: t['name']), 'quests': sorted(quests, key=lambda q: q['nameRu'] or q['name'] or '')}
        with open(os.path.join(out_dir, f'{map_id}.quests.json'), 'w', encoding='utf-8') as f:
            json.dump(qdata, f, ensure_ascii=False, separators=(',', ':'))
        print(map_id, 'markers', len(markers), 'bosses', sum(1 for m in markers if m['type'] == 'boss'), 'labels', len(locations), 'samples', len(samples),
              'ground', round(ground, 1), 'quests', len(quests), 'exits', len(exits))


main()
