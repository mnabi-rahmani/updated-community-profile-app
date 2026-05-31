import base64
import json
import os
import tempfile
from pathlib import Path

import arcpy


DEPLOYED_DIR = Path(__file__).resolve().parents[1]
ASSETS_DIR = DEPLOYED_DIR / "Assets Needed"
DATA_DIR = DEPLOYED_DIR / "cursor_v2_map_data"
ICON_DIR = DATA_DIR / "icons"
GDB_PATH = ASSETS_DIR / "Integrated Locations Database.gdb"
FACILITIES_DATASET = GDB_PATH / "Facilities"
OUTPUT_PATH = DATA_DIR / "layers_bundle.js"
WGS84 = arcpy.SpatialReference(4326)
MAPS_V8_APRX = ASSETS_DIR / "Maps V8" / "Maps.aprx"
MAPS_V8_WORKING_MAP = "Kunduz & Baghlan Working Files"


LAYER_CONFIG = {
    "MinorRoads": {
        "id": "minor_roads",
        "label": "Minor roads",
        "group": "Access",
        "style": {"strokeColor": "#c08457", "strokeWidth": 2}
    },
    "MainRoad": {
        "id": "main_roads",
        "label": "Main roads",
        "group": "Access",
        "style": {"strokeColor": "#b95f2a", "strokeWidth": 3}
    },
    "BoundaryCommunity": {
        "id": "boundary_community",
        "label": "Community boundaries",
        "group": "Boundaries",
        "style": {"strokeColor": "#cccccc", "strokeWidth": 1, "fillColor": "#259070", "fillOpacity": 0}
    },
    "BoundaryCluster": {
        "id": "boundary_cluster",
        "label": "Cluster boundaries",
        "group": "Boundaries",
        "style": {"strokeColor": "#002673", "strokeWidth": 2, "fillColor": "#e9ffbe", "fillOpacity": 0.2}
    },
    "Mosque": {
        "id": "mosques",
        "label": "Mosques",
        "group": "Facilities",
        "style": {"markerFill": "#64748b", "pointRadius": 4}
    },
    "CHC": {
        "id": "chc",
        "label": "CHC",
        "group": "Health",
        "style": {"icon": "cursor_v2_map_data/icons/chc.png", "markerFill": "#c0392b"}
    },
    "BHC": {
        "id": "bhc",
        "label": "BHC",
        "group": "Health",
        "style": {"icon": "cursor_v2_map_data/icons/chc.png", "markerFill": "#c0392b"}
    },
    "MHT": {
        "id": "mht",
        "label": "Mobile health teams",
        "group": "Health",
        "style": {"icon": "cursor_v2_map_data/icons/mht.png", "markerFill": "#c0392b"}
    },
    "ShopOrMarket": {
        "id": "shops_markets",
        "label": "Shops / markets",
        "group": "Facilities",
        "style": {"markerFill": "#4a5568", "pointRadius": 4}
    },
    "ShelterConstruction": {
        "id": "shelter_construction",
        "label": "Shelter construction",
        "group": "Shelter",
        "style": {"icon": "cursor_v2_map_data/icons/shelterConstruction.png", "markerFill": "#7c5d9c"}
    },
    "CellTower": {
        "id": "cell_towers",
        "label": "Cell towers",
        "group": "Facilities",
        "style": {"markerFill": "#4a5568", "pointRadius": 4}
    },
    "School": {
        "id": "schools",
        "label": "Schools",
        "group": "Education",
        "style": {"icon": "cursor_v2_map_data/icons/school.png", "markerFill": "#315f9f"}
    },
    "Madrassa": {
        "id": "madrassas",
        "label": "Madrassas",
        "group": "Education",
        "style": {"icon": "cursor_v2_map_data/icons/madrassa.png", "markerFill": "#315f9f"}
    },
    "WaterNet": {
        "id": "water_network",
        "label": "Water network",
        "group": "WASH",
        "style": {"icon": "cursor_v2_map_data/icons/waterNetwork.png", "markerFill": "#1f7fa8", "strokeColor": "#1f7fa8", "strokeWidth": 2}
    },
    "WaterWell": {
        "id": "water_wells",
        "label": "Water wells",
        "group": "WASH",
        "style": {"icon": "cursor_v2_map_data/icons/waterWell.png", "markerFill": "#1f7fa8"}
    },
    "WaterStorePoint": {
        "id": "water_storage",
        "label": "Water storage points",
        "group": "WASH",
        "style": {"icon": "cursor_v2_map_data/icons/waterStorePoint.png", "markerFill": "#1f7fa8"}
    },
    "WaterKarez": {
        "id": "water_karez",
        "label": "Water karez",
        "group": "WASH",
        "style": {"icon": "cursor_v2_map_data/icons/waterNetwork.png", "markerFill": "#1f7fa8"}
    },
    "WaterIntake": {
        "id": "water_intakes",
        "label": "Water intakes",
        "group": "WASH",
        "style": {"icon": "cursor_v2_map_data/icons/waterIntake.png", "markerFill": "#1f7fa8"}
    },
    "ProtectionWallLine": {
        "id": "protection_walls",
        "label": "Protection walls",
        "group": "Flood / DRR",
        "style": {"strokeColor": "#2f7d72", "strokeWidth": 3}
    },
    "FloodWayLine": {
        "id": "flood_ways",
        "label": "Flood ways",
        "group": "Flood / DRR",
        "style": {"strokeColor": "#2f7d72", "strokeWidth": 3}
    },
    "Flood_Way_Paths": {
        "id": "flood_way_paths",
        "label": "Flood way paths",
        "group": "Flood / DRR",
        "style": {"strokeColor": "#2f7d72", "strokeWidth": 2}
    },
    "Bridge": {
        "id": "bridges",
        "label": "Bridges",
        "group": "Access",
        "style": {"markerFill": "#b95f2a", "pointRadius": 5}
    },
    "Culver": {
        "id": "culverts",
        "label": "Culverts",
        "group": "Access",
        "style": {"icon": "cursor_v2_map_data/icons/culvert.png", "markerFill": "#b95f2a"}
    },
    "Canal": {
        "id": "canals",
        "label": "Canals",
        "group": "Irrigation",
        "style": {"icon": "cursor_v2_map_data/icons/canal.png", "markerFill": "#6b8e23", "strokeColor": "#6b8e23", "strokeWidth": 2}
    },
    "OilTank": {
        "id": "oil_tanks",
        "label": "Oil tanks",
        "group": "Facilities",
        "style": {"markerFill": "#4a5568", "pointRadius": 4}
    },
    "ZahooMulaQudrat": {
        "id": "zahoo_mula_qudrat",
        "label": "Zahoo Mula Qudrat",
        "group": "Facilities",
        "style": {"icon": "cursor_v2_map_data/icons/village.png", "markerFill": "#259070"}
    },
    "Teera": {
        "id": "teera",
        "label": "Teera",
        "group": "Facilities",
        "style": {"icon": "cursor_v2_map_data/icons/village.png", "markerFill": "#259070"}
    }
}


def slug(value):
    result = []
    for char in value:
        if char.isalnum():
            result.append(char.lower())
        elif result and result[-1] != "_":
            result.append("_")
    return "".join(result).strip("_")


def feature_class_name_from_layer(layer):
    try:
        data_source = layer.dataSource
    except Exception:
        return None

    normalized = data_source.replace("\\", "/").rstrip("/")
    return normalized.split("/")[-1] or None


def first_symbol_layer(layer):
    try:
        definition = layer.getDefinition("V3")
        renderer = getattr(definition, "renderer", None)
        symbol_reference = getattr(renderer, "symbol", None)
        symbol = getattr(symbol_reference, "symbol", None)
        symbol_layers = getattr(symbol, "symbolLayers", None) or []
        return symbol_layers[0] if symbol_layers else None
    except Exception:
        return None


def rgb_to_hex(color):
    if not color:
        return None
    values = getattr(color, "values", None) or []
    if len(values) < 3:
        return None
    return "#{:02x}{:02x}{:02x}".format(int(values[0]), int(values[1]), int(values[2]))


def write_data_url_icon(layer_id, data_url):
    if not data_url or not data_url.startswith("data:image/"):
        return None

    header, encoded = data_url.split(",", 1)
    extension = "png"
    if "jpeg" in header or "jpg" in header:
        extension = "jpg"

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    icon_name = f"map_v8_{layer_id}.{extension}"
    icon_path = ICON_DIR / icon_name
    icon_path.write_bytes(base64.b64decode(encoded))
    return f"cursor_v2_map_data/icons/{icon_name}"


def maps_v8_point_styles():
    if not MAPS_V8_APRX.exists():
        return {}

    project = arcpy.mp.ArcGISProject(str(MAPS_V8_APRX))
    maps = project.listMaps(MAPS_V8_WORKING_MAP)
    if not maps:
        return {}

    styles = {}
    for layer in maps[0].listLayers():
        if layer.isGroupLayer or not layer.isFeatureLayer:
            continue

        feature_class = feature_class_name_from_layer(layer)
        if not feature_class:
            continue

        config = LAYER_CONFIG.get(feature_class)
        if not config:
            continue

        try:
            shape_type = arcpy.Describe(str(FACILITIES_DATASET / feature_class)).shapeType
        except Exception:
            continue
        if shape_type != "Point":
            continue

        style = {}
        symbol_layer = first_symbol_layer(layer)
        if symbol_layer:
            icon = write_data_url_icon(config["id"], getattr(symbol_layer, "url", None))
            if icon:
                size = getattr(symbol_layer, "size", None) or 22
                style["icon"] = icon
                style["iconSize"] = [round(float(size)), round(float(size))]
            fill_color = rgb_to_hex(getattr(symbol_layer, "color", None))
            if fill_color:
                style["markerFill"] = fill_color

        try:
            renderer_symbol = layer.symbology.renderer.symbol
            if not style.get("markerFill"):
                color = renderer_symbol.color
                if "RGB" in color:
                    rgb = color["RGB"]
                    style["markerFill"] = "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))
            if not style.get("pointRadius") and getattr(renderer_symbol, "size", None):
                style["pointRadius"] = max(4, round(float(renderer_symbol.size) / 2))
        except Exception:
            pass

        if style:
            styles[feature_class] = style

    return styles


def feature_class_paths():
    paths = [GDB_PATH / "Communities"]
    arcpy.env.workspace = str(FACILITIES_DATASET)
    for name in arcpy.ListFeatureClasses() or []:
        paths.append(FACILITIES_DATASET / name)
    return paths


def geometry_name(shape_type):
    if shape_type == "Point":
        return "point"
    if shape_type == "Polyline":
        return "line"
    if shape_type == "Polygon":
        return "polygon"
    return shape_type.lower()


def projected_feature_class(feature_class_path, temp_dir):
    description = arcpy.Describe(str(feature_class_path))
    spatial_reference = description.spatialReference
    if spatial_reference and spatial_reference.factoryCode == 4326:
        return str(feature_class_path)

    temp_gdb = Path(temp_dir) / "projected.gdb"
    if not temp_gdb.exists():
        arcpy.management.CreateFileGDB(str(Path(temp_dir)), "projected.gdb")

    output_name = arcpy.ValidateTableName(f"{feature_class_path.name}_wgs84", str(temp_gdb))
    output_path = temp_gdb / output_name
    arcpy.management.Project(str(feature_class_path), str(output_path), WGS84)
    return str(output_path)


def export_geojson(feature_class_path, temp_dir):
    output_json = Path(temp_dir) / f"{feature_class_path.name}.geojson"
    export_source = projected_feature_class(feature_class_path, temp_dir)
    arcpy.conversion.FeaturesToJSON(
        export_source,
        str(output_json),
        "NOT_FORMATTED",
        "NO_Z_VALUES",
        "NO_M_VALUES",
        "GEOJSON"
    )
    with output_json.open("r", encoding="utf-8") as file:
        return json.load(file)


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    v8_point_styles = maps_v8_point_styles()
    styles = {}
    layers = {}
    manifest = []

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp_dir:
        for feature_class_path in feature_class_paths():
            name = feature_class_path.name
            config = LAYER_CONFIG.get(name)
            if not config:
                continue

            description = arcpy.Describe(str(feature_class_path))
            layer_id = config["id"]
            layers[layer_id] = export_geojson(feature_class_path, temp_dir)
            styles[layer_id] = {**config["style"], **v8_point_styles.get(name, {})}
            manifest.append({
                "id": layer_id,
                "label": config["label"],
                "group": config["group"],
                "geometry": geometry_name(description.shapeType),
                "source": name
            })

    manifest.sort(key=lambda item: (item["group"], item["label"]))

    content = "\n".join([
        "// Generated from Assets Needed/Integrated Locations Database.gdb via ArcGIS Pro arcpy.",
        f"window.CURSOR_V2_STYLES = {json.dumps(styles, ensure_ascii=False)};",
        f"window.CURSOR_V2_LAYERS = {json.dumps(layers, ensure_ascii=False)};",
        f"window.CURSOR_V2_LAYER_MANIFEST = {json.dumps(manifest, ensure_ascii=False)};",
        ""
    ])

    OUTPUT_PATH.write_text(content, encoding="utf-8")
    print(json.dumps({
        "layers": len(layers),
        "features": {layer_id: len(layer.get("features", [])) for layer_id, layer in layers.items()},
        "output": str(OUTPUT_PATH)
    }, indent=2))


if __name__ == "__main__":
    main()
