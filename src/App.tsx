import {
    Map,
    MapControls,
    MapDrawControl,
    MapDrawModes,
    MapDrawToolbar,
    MapDrawPoint,
    MapDrawLine,
    MapDrawPolygon,
    MapDrawRectangle,
    MapDrawCircle,
    MapDrawSelect,
    MapDrawDelete,
    MapDrawDownload,
    MapDrawImport,
    MapDrawMapManager,
} from "@/components/ui/map"

export function App() {
    return (
        <div className="h-dvh w-screen">
            <Map center={[-86.1581, 39.7684]} zoom={13}>
                <MapControls showZoom showFullscreen showLocate />
                <MapDrawControl position="bottom-left">
                    <MapDrawModes>
                        <MapDrawPoint />
                        <MapDrawLine />
                        <MapDrawPolygon />
                        <MapDrawRectangle />
                        <MapDrawCircle />
                        <MapDrawSelect />
                    </MapDrawModes>
                    <MapDrawToolbar>
                        <MapDrawDelete />
                        <MapDrawDownload />
                        <MapDrawImport />
                        <MapDrawMapManager />
                    </MapDrawToolbar>
                </MapDrawControl>
            </Map>
        </div>
    )
}

export default App
