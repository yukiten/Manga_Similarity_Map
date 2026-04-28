import { useNavigate } from 'react-router-dom'
import { MEDIA_CONFIG } from './mediaConfig'

export default function TopPage() {
  const navigate = useNavigate()

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#f5f4f0',
      backgroundImage: 'radial-gradient(circle, #d8d6cf 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "system-ui, 'Segoe UI', sans-serif",
      padding: '40px 24px',
      boxSizing: 'border-box',
    }}>

      {/* ロゴエリア */}
      <div style={{ textAlign: 'center', marginBottom: 52, animation: 'fadeUp 0.6s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ height: 1, width: 32, background: '#c43030', opacity: 0.5 }} />
          <div style={{ fontSize: 10, fontFamily: "'Courier New', monospace", letterSpacing: '0.25em', color: '#c43030', textTransform: 'uppercase' }}>
            Similarity Explorer
          </div>
          <div style={{ height: 1, width: 32, background: '#c43030', opacity: 0.5 }} />
        </div>

        <h1 style={{
          margin: 0,
          fontSize: 'clamp(36px, 6vw, 58px)',
          fontWeight: 900,
          letterSpacing: '-0.05em',
          color: '#1a1820',
          lineHeight: 1,
        }}>
          Media Map
        </h1>

        <p style={{
          margin: '14px 0 0',
          fontSize: 14,
          color: '#8a8880',
          lineHeight: 1.6,
          letterSpacing: '0.02em',
        }}>
          作品の類似関係を探索するデータベース
        </p>
      </div>

      {/* カードグリッド */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 250px))',
        gap: 14,
        width: '100%',
        maxWidth: 560,
        justifyContent: 'center',
      }}>
        {Object.entries(MEDIA_CONFIG).map(([type, config], i) => (
          <MediaCard
            key={type}
            config={config}
            animDelay={i * 0.08}
            onClick={() => config.available && navigate(`/${type}`)}
          />
        ))}
      </div>

      <div style={{ marginTop: 56, fontSize: 10, color: '#c0bdb8', letterSpacing: '0.15em', fontFamily: "'Courier New', monospace", animation: 'fadeUp 0.6s ease 0.4s both' }}>
        MEDIA MAP · 2025
      </div>
    </div>
  )
}

function MediaCard({ config, onClick, animDelay }) {
  const available = config.available

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 12,
        padding: '24px 22px',
        background: available ? '#faf9f5' : '#faf8f5',
        border: `1px solid ${available ? '#e8e6df' : '#edebe6'}`,
        cursor: available ? 'pointer' : 'default',
        transition: 'border-color 0.18s, transform 0.18s, box-shadow 0.18s',
        opacity: available ? 1 : 0.55,
        boxShadow: available ? '0 2px 10px rgba(0,0,0,0.07)' : 'none',
        animation: `fadeUp 0.5s ease ${animDelay}s both`,
      }}
      onMouseEnter={e => {
        if (!available) return
        e.currentTarget.style.borderColor = '#c43030'
        e.currentTarget.style.transform = 'translateY(-4px)'
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(196,48,48,0.12)'
      }}
      onMouseLeave={e => {
        if (!available) return
        e.currentTarget.style.borderColor = '#e8e6df'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.07)'
      }}
    >
      {!available && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: '#aaa8a0', background: '#f0ede8',
          border: '1px solid #e0ddd8', borderRadius: 4, padding: '2px 7px',
          fontFamily: "'Courier New', monospace",
        }}>
          Soon
        </div>
      )}

      <div style={{ fontSize: 32, marginBottom: 14, filter: available ? 'none' : 'grayscale(1) opacity(0.6)' }}>
        {config.icon}
      </div>

      <div style={{ fontSize: 18, fontWeight: 800, color: available ? '#1a1820' : '#aaa8a0', marginBottom: 2, letterSpacing: '-0.02em' }}>
        {config.label}
      </div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c0bdb8', marginBottom: 10, fontFamily: "'Courier New', monospace" }}>
        {config.labelEn}
      </div>
      <div style={{ fontSize: 12, color: '#8a8880', lineHeight: 1.6 }}>
        {config.description}
      </div>

      {available && (
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ height: 1, width: 16, background: '#c43030' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c43030' }}>開く</span>
        </div>
      )}
    </div>
  )
}
