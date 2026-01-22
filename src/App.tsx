import {
    Map,
    MapControls,
    MapDrawControl,
    MapDrawPoint,
    MapDrawLine,
    MapDrawPolygon,
    MapDrawRectangle,
    MapDrawCircle,
    MapDrawSelect,
    MapDrawDelete,
    MapDrawDownload,
} from "@/components/ui/map"

export function App() {
    return (
        <div className="h-screen w-screen">
            <Map center={[-86.1581, 39.7684]} zoom={13}>
                <MapControls showZoom showFullscreen showLocate />
                <MapDrawControl position="bottom-left">
                    <MapDrawPoint />
                    <MapDrawLine />
                    <MapDrawPolygon />
                    <MapDrawRectangle />
                    <MapDrawCircle />
                    <MapDrawSelect />
                    <MapDrawDelete />
                    <MapDrawDownload />
                </MapDrawControl>
            </Map>
        </div>
    )
}

export default App
