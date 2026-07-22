export const CONFIG = {
    BACKEND_URL: 'http://localhost:5000/documents/process',
    AUTH_URL: 'http://localhost:5000/auth/token',
    DELAY_MS: {
        SELECT_DOC: 1000,
        CLICK_SAVE_TRANSFER: 1200,
        OPEN_TREE: 800,
        TREE_SEARCH: 500,
        CLOSE_TREE: 350,
        AFTER_SUBMIT: 1800,
        BETWEEN_DOCS: 800
    }
};

export const S = {
    LEFT_LIST: '#listview-process-list-list-content div.messageListItem',
    LEFT_LIST_FALLBACK: 'div.messageListItem[data-id]',
    SAVE_TRANSFER_BTN: '#ed-view-btn-transfer',
    TRANSFER_CONTAINER: '#ed-transfer-document-container',
    RESPONSIBLE_LINK: '#ed-transfer-select-user-responsible a.user-box-link',
    RESPONSIBLE_WRAP: '#ed-transfer-select-user-responsible',
    PARTICIPANTS_LINK: '#ed-transfer-select-user-participants a.user-box-link',
    PARTICIPANTS_WRAP: '#ed-transfer-select-user-participants',
    DEADLINE_INPUT: '#ed-transfer-txt-deadline',
    DEADLINE_NUMBER: '#ed-transfer-txt-deadline-number',
    PRIORITY_SELECT: '#ed-transfer-select-priority',
    CONTENT_TEXTAREA: '#ed-transfer-txt-content',
    AGREE_BTN: '#ed-transfer-btn-transfer',
    CANCEL_BTN: '#ed-transfer-btn-cancel'
};
