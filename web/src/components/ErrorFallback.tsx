export function ErrorFallback() {
  return (
    <div style={{
      padding: '2rem',
      maxWidth: '500px',
      margin: '4rem auto',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
    }}>
      <h1 style={{ color: '#ef4444' }}>Something went wrong</h1>
      <p>The settings page encountered an error. Please refresh the page.</p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          cursor: 'pointer',
          background: '#facc15',
          color: 'black',
          border: 'none',
          borderRadius: '4px',
          fontWeight: 'bold',
        }}
      >
        Reload Page
      </button>
    </div>
  )
}
