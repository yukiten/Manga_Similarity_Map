import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MEDIA_CONFIG } from './mediaConfig'
import MapApp from './MapApp'
import TopPage from './TopPage'
import MangaPortalPage from './MangaPortalPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TopPage />} />

        {/* マンガ: ポータル → マップ（2Dデフォルト） → 詳細 */}
        <Route path="/manga" element={<MangaPortalPage />} />
        <Route path="/manga/map" element={<MapApp config={MEDIA_CONFIG.manga} mediaType="manga" mapBasePath="/manga/map" />} />
        <Route path="/manga/:mangaId" element={<MapApp config={MEDIA_CONFIG.manga} mediaType="manga" mapBasePath="/manga/map" />} />

        {/* その他メディア */}
        {Object.entries(MEDIA_CONFIG)
          .filter(([type]) => type !== 'manga')
          .flatMap(([type, config]) => [
            <Route key={type}     path={`/${type}`}           element={<MapApp config={config} mediaType={type} mapBasePath={`/${type}`} />} />,
            <Route key={`${type}-id`} path={`/${type}/:mangaId`} element={<MapApp config={config} mediaType={type} mapBasePath={`/${type}`} />} />,
          ])}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
