export const CSS_STYLES = `
    /* ===== iDesk RPA Minimalist UI v2.3 (Pure Text) ===== */
    #idesk-rpa-hub {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        width: min(1680px, 95vw) !important;
        height: min(680px, 85vh) !important;
        background: #121212 !important;
        border: 1px solid #282828 !important;
        border-radius: 8px !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35) !important;
        color: #EAEAEA !important;
        font-family: 'SF Pro Display', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        z-index: 999999 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
        transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease !important;
        user-select: none !important;
    }
    #idesk-rpa-hub.rpa-dragging { transition: none !important; }
    #idesk-rpa-hub * { box-sizing: border-box !important; }

    #idesk-rpa-hub.minimized {
        width: 340px !important;
        height: 42px !important;
        border-radius: 6px !important;
    }
    #idesk-rpa-hub.minimized .rpa-body,
    #idesk-rpa-hub.minimized .rpa-footer { display: none !important; }

    .rpa-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 10px 16px !important;
        background: #181818 !important;
        border-bottom: 1px solid #262626 !important;
        cursor: grab !important;
        min-height: 42px !important;
    }
    .rpa-header:active { cursor: grabbing !important; }

    .rpa-title {
        font-weight: 600 !important;
        font-size: 14px !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        color: #FFFFFF !important;
        letter-spacing: -0.01em !important;
    }
    .rpa-title .badge-count {
        background: #262626 !important;
        color: #A1A1AA !important;
        font-size: 11px !important;
        padding: 1px 8px !important;
        border-radius: 9999px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }

    .rpa-header-actions { display: flex !important; gap: 6px !important; }
    .rpa-header-actions button {
        background: transparent !important;
        border: 1px solid #2A2A2A !important;
        color: #A1A1AA !important;
        cursor: pointer !important;
        padding: 4px 10px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        transition: all 0.15s !important;
    }
    .rpa-header-actions button:hover {
        background: #262626 !important;
        color: #FFFFFF !important;
    }

    .rpa-body {
        flex: 1 !important;
        padding: 14px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        overflow: hidden !important;
    }

    .rpa-toolbar {
        display: flex !important;
        gap: 10px !important;
        align-items: center !important;
    }

    .rpa-btn {
        background: #1A1A1A !important;
        border: 1px solid #333333 !important;
        color: #EAEAEA !important;
        border-radius: 4px !important;
        padding: 8px 18px !important;
        font-weight: 500 !important;
        font-size: 13px !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        transition: background 0.15s, transform 0.1s !important;
    }
    .rpa-btn:hover { background: #262626 !important; color: #FFFFFF !important; }
    .rpa-btn:active { transform: scale(0.98) !important; }

    .rpa-btn-primary {
        background: #FFFFFF !important;
        color: #111111 !important;
        border: 1px solid #FFFFFF !important;
        font-weight: 600 !important;
    }
    .rpa-btn-primary:hover { background: #E5E5E5 !important; }

    .rpa-btn-purple {
        background: #EAEAEA !important;
        color: #111111 !important;
        border: 1px solid #EAEAEA !important;
        font-weight: 600 !important;
    }
    .rpa-btn-purple:hover { background: #D4D4D4 !important; }

    .rpa-btn-outline {
        background: transparent !important;
        border: 1px solid #2E2E2E !important;
        color: #A1A1AA !important;
    }
    .rpa-btn-outline:hover { border-color: #444444 !important; color: #FFFFFF !important; }

    .rpa-table-wrap {
        flex: 1 !important;
        overflow-y: auto !important;
        border: 1px solid #262626 !important;
        border-radius: 6px !important;
        background: #121212 !important;
    }
    .rpa-table-wrap::-webkit-scrollbar { width: 6px !important; }
    .rpa-table-wrap::-webkit-scrollbar-thumb { background: #262626 !important; border-radius: 3px !important; }

    .rpa-table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 13px !important;
    }
    .rpa-table th {
        background: #181818 !important;
        color: #888888 !important;
        font-weight: 600 !important;
        padding: 10px 12px !important;
        position: sticky !important;
        top: 0 !important;
        z-index: 1 !important;
        border-bottom: 1px solid #262626 !important;
        font-size: 11px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        text-align: left !important;
    }

    .rpa-row-main {
        cursor: pointer !important;
        transition: background 0.15s !important;
    }
    .rpa-row-main:hover { background: #18181B !important; }
    .rpa-row-main.expanded { background: #1C1C1F !important; }

    .rpa-row-main td {
        padding: 12px 12px !important;
        border-bottom: 1px solid #222225 !important;
        vertical-align: middle !important;
        color: #E4E4E7 !important;
    }

    .rpa-doc-code {
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-weight: 600 !important;
        color: #FFFFFF !important;
        font-size: 13px !important;
    }
    .rpa-doc-text {
        max-width: 320px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        color: #D4D4D8 !important;
        line-height: 1.5 !important;
    }

    .rpa-toggle-text {
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 11px !important;
        color: #71717A !important;
    }

    .rpa-row-detail {
        background: #161618 !important;
        border-bottom: 1px solid #262626 !important;
    }
    .rpa-row-detail td {
        padding: 16px 20px !important;
    }
    .rpa-detail-grid {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 14px 24px !important;
        background: #111113 !important;
        padding: 16px !important;
        border-radius: 6px !important;
        border: 1px solid #242427 !important;
    }
    .rpa-detail-field {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
    }
    .rpa-detail-field.span-2 { grid-column: span 2 !important; }
    .rpa-detail-field.span-full { grid-column: span 3 !important; }

    .rpa-detail-label {
        font-size: 11px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #71717A !important;
        font-weight: 500 !important;
    }
    .rpa-detail-value {
        font-size: 13px !important;
        color: #E4E4E7 !important;
        line-height: 1.5 !important;
        word-break: break-word !important;
    }
    .rpa-detail-value.highlight {
        color: #FFFFFF !important;
        font-weight: 500 !important;
    }

    .rpa-badge {
        display: inline-flex !important;
        align-items: center !important;
        padding: 3px 10px !important;
        border-radius: 9999px !important;
        font-weight: 500 !important;
        font-size: 11px !important;
        letter-spacing: 0.03em !important;
        text-transform: uppercase !important;
    }
    .rpa-badge-idle { background: #27272A !important; color: #A1A1AA !important; }
    .rpa-badge-pending { background: #2E2211 !important; color: #F59E0B !important; }
    .rpa-badge-success { background: #14291B !important; color: #4ADE80 !important; }
    .rpa-badge-error { background: #2D1517 !important; color: #F87171 !important; }
    .rpa-badge-sent { background: #102030 !important; color: #60A5FA !important; }

    .rpa-footer {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 16px !important;
        background: #181818 !important;
        border-top: 1px solid #262626 !important;
        gap: 16px !important;
    }
    .rpa-status-text {
        font-size: 12px !important;
        color: #A1A1AA !important;
        flex: 1 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
    }
    .rpa-progress-wrap { display: flex !important; align-items: center !important; gap: 10px !important; }
    .rpa-progress-bar {
        width: 120px !important;
        height: 4px !important;
        background: #262626 !important;
        border-radius: 2px !important;
        overflow: hidden !important;
    }
    .rpa-progress-fill {
        height: 100% !important;
        background: #EAEAEA !important;
        width: 0% !important;
        transition: width 0.2s !important;
    }
    .rpa-progress-text {
        font-size: 11px !important;
        color: #A1A1AA !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }

    .rpa-log-panel {
        max-height: 0 !important;
        overflow-y: auto !important;
        transition: max-height 0.25s !important;
        background: #0D0D0D !important;
        border-radius: 4px !important;
    }
    .rpa-log-panel.open {
        max-height: 120px !important;
        padding: 8px 12px !important;
        border: 1px solid #262626 !important;
    }
    .rpa-log-entry {
        font-size: 11px !important;
        color: #888888 !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        line-height: 1.6 !important;
    }
    .rpa-log-time { color: #555555 !important; margin-right: 8px !important; }
`;
