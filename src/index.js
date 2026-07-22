import { interceptXHR, interceptFetch } from './services/interceptor.js';
import { createDashboard } from './ui/dashboard.js';

const init = () => {
    interceptXHR();
    interceptFetch();

    const waitAndStart = () => {
        if (!document.getElementById('process-list-widget')) {
            setTimeout(waitAndStart, 400);
            return;
        }
        createDashboard();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitAndStart);
    } else {
        waitAndStart();
    }
};

init();
