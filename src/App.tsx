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
    MapDrawStepper,
} from "@/components/ui/map"
import { MapAssetControl } from "@/components/ui/map-assets"
import { MapSlideControl } from "@/components/ui/map-slides"
import { MapTimeline, MapTimelineControl } from "@/components/ui/map-timeline"

export function App() {
    return (
        <div className="h-dvh w-screen">
            <Map center={[-104.89244, 34.099547]} zoom={6.5}>
                <MapControls showZoom showFullscreen showLocate />
                <MapTimeline>
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
                        <MapDrawStepper />
                    </MapDrawControl>
                    <MapAssetControl position="top-right" />
                    <MapSlideControl position="top-right" className="top-12" />
                    <MapTimelineControl />
                </MapTimeline>
            </Map>
        </div>
    )
}

export default App
