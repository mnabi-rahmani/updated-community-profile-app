import json
from pathlib import Path

import arcpy


DEPLOYED_DIR = Path(__file__).resolve().parents[1]
APRX_PATH = DEPLOYED_DIR / "Assets Needed" / "Maps V8" / "Maps.aprx"
WORKING_MAP_NAME = "Kunduz & Baghlan Working Files"


def symbol_layers(symbol_reference):
    symbol = getattr(symbol_reference, "symbol", None)
    if symbol is None:
        return []
    return getattr(symbol, "symbolLayers", []) or []


def layer_summary(layer):
    row = {
        "name": layer.name,
        "visible": layer.visible,
        "isFeatureLayer": layer.isFeatureLayer,
    }

    try:
        row["dataSource"] = layer.dataSource
    except Exception as error:
        row["dataSourceError"] = str(error)

    try:
        symbology = layer.symbology
        renderer = symbology.renderer
        row["renderer"] = renderer.type
        symbol = getattr(renderer, "symbol", None)
        if symbol is not None:
            row["simpleSymbol"] = {
                "color": getattr(symbol, "color", None),
                "size": getattr(symbol, "size", None),
                "outlineColor": getattr(symbol, "outlineColor", None),
                "outlineWidth": getattr(symbol, "outlineWidth", None),
            }
    except Exception as error:
        row["symbologyError"] = str(error)

    try:
        definition = layer.getDefinition("V3")
        renderer = getattr(definition, "renderer", None)
        symbol_ref = getattr(renderer, "symbol", None)
        cim_layers = []
        for symbol_layer in symbol_layers(symbol_ref):
            cim_layers.append({
                "type": symbol_layer.__class__.__name__,
                "enable": getattr(symbol_layer, "enable", None),
                "size": getattr(symbol_layer, "size", None),
                "color": getattr(symbol_layer, "color", None).values if getattr(symbol_layer, "color", None) else None,
                "outlineColor": getattr(symbol_layer, "outlineColor", None).values if getattr(symbol_layer, "outlineColor", None) else None,
                "url": getattr(symbol_layer, "url", None),
                "markerPlacement": getattr(symbol_layer, "markerPlacement", None).__class__.__name__ if getattr(symbol_layer, "markerPlacement", None) else None,
            })
        row["cimSymbolLayers"] = cim_layers
    except Exception as error:
        row["cimError"] = str(error)

    return row


def main():
    project = arcpy.mp.ArcGISProject(str(APRX_PATH))
    maps = project.listMaps(WORKING_MAP_NAME)
    if not maps:
        raise RuntimeError(f"Map not found: {WORKING_MAP_NAME}")

    rows = []
    for layer in maps[0].listLayers():
        if layer.isGroupLayer or not layer.isFeatureLayer:
            continue
        shape_type = None
        describe_error = None
        try:
            description = arcpy.Describe(layer.dataSource)
            shape_type = getattr(description, "shapeType", None)
        except Exception as error:
            describe_error = str(error)
        row = layer_summary(layer)
        row["shapeType"] = shape_type
        row["describeError"] = describe_error
        rows.append(row)

    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
