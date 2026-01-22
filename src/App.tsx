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
            <Map center={[-104.89244, 34.099547]} zoom={6.5}>
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
