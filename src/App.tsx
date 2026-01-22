import {
    Map,
    MapTileLayer,
    MapDrawControl,
    MapDrawMarker,
    MapDrawPolyline,
    MapDrawCircle,
    MapDrawRectangle,
    MapDrawPolygon,
    MapDrawEdit,
    MapDrawDelete,
    MapDrawUndo,
    MapZoomControl,
    MapFullscreenControl,
} from "@/components/ui/map"

export function App() {
    return (
        <div className="h-screen w-screen">
            <Map center={[39.7684, -86.1581]} zoom={13} className="h-full w-full rounded-none">
                <MapTileLayer />
                <MapZoomControl />
                <MapFullscreenControl />
                <MapDrawControl>
                    <MapDrawMarker />
                    <MapDrawPolyline />
                    <MapDrawCircle />
                    <MapDrawRectangle />
                    <MapDrawPolygon />
                    <MapDrawEdit />
                    <MapDrawDelete />
                    <MapDrawUndo />
                </MapDrawControl>
            </Map>
        </div>
    )
}

export default App
