'use client';
import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { crashed: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  render() {
    if (this.state.crashed) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: '#0d0d0d',
          color: '#a0a0a0', fontFamily: 'monospace', gap: 16,
        }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#7c6af7' }}>B&gt;</div>
          <div style={{ fontSize: 14 }}>Something went wrong.</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px', background: '#7c6af7', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
