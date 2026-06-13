import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MEDIA_CONFIG } from './mediaConfig'
import MapApp from './MapApp'
import TopPage from './TopPage'
import MangaPortalPage from './MangaPortalPage'
import UserPage from './pages/UserPage'
import ListDetailPage from './pages/ListDetailPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TopPage />} />

        {/* マンガ: ポータル → マップ（2Dデフォルト） → 詳細 */}
        <Route path="/manga" element={<MangaPortalPage />} />
        <Route path="/manga/map" element={<MapApp config={MEDIA_CONFIG.manga} mediaType="manga" mapBasePath="/manga/map" />} />
        <Route path="/manga/:slug" element={<MapApp config={MEDIA_CONFIG.manga} mediaType="manga" mapBasePath="/manga/map" />} />

        {/* その他メディア */}
        {Object.entries(MEDIA_CONFIG)
          .filter(([type]) => type !== 'manga')
          .flatMap(([type, config]) => [
            <Route key={type}     path={`/${type}`}           element={<MapApp config={config} mediaType={type} mapBasePath={`/${type}`} />} />,
            <Route key={`${type}-id`} path={`/${type}/:slug`} element={<MapApp config={config} mediaType={type} mapBasePath={`/${type}`} />} />,
          ])}

        {/* ユーザーページ・リスト詳細 */}
        <Route path="/user/:username" element={<UserPage />} />
        <Route path="/list/:listId"   element={<ListDetailPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
