// api.js — เชื่อมต่อ Python Backend (Local SQLite Server)
const API_URL = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol.startsWith('http'))
    ? (window.location.origin + '/')
    : 'http://localhost:8000/';

const API = (() => {
    async function fetchOnce(action, args, timeoutMs) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);

        let res;
        try {
            res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: action, args: args }),
                signal: ctrl.signal
            });
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('เซิร์ฟเวอร์ไม่ตอบกลับภายในเวลาที่กำหนด');
            throw err;
        } finally {
            clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`Server ตอบกลับ ${res.status}`);

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('ไม่สามารถแปลงข้อมูลตอบกลับจากเซิร์ฟเวอร์ได้');
        }
        if (data.error) throw new Error(data.error);
        return data.result;
    }

    const RETRYABLE = { getMenu: 1, getAllMenuForAdmin: 1, getOrdersByDate: 1 };
    const SLOW_WRITE = { addMenuItem: 1, updateMenuItem: 1 };

    const TIMEOUT_READ = 20000;
    const TIMEOUT_WRITE = 25000;
    const TIMEOUT_UPLOAD = 60000;
    const TIMEOUT_LOGIN = 12000;

    async function viaFetch(action, args) {
        const retryable = !!RETRYABLE[action];
        const tries = retryable ? 3 : 1;
        const timeoutMs = action === 'checkLogin' ? TIMEOUT_LOGIN
            : retryable ? TIMEOUT_READ
                : SLOW_WRITE[action] ? TIMEOUT_UPLOAD
                    : TIMEOUT_WRITE;
        let lastErr;
        for (let i = 0; i < tries; i++) {
            try {
                return await fetchOnce(action, args, timeoutMs);
            } catch (err) {
                lastErr = err;
                if (i < tries - 1) await new Promise(r => setTimeout(r, 700 * (i + 1)));
            }
        }
        throw lastErr;
    }

    const call = (action, ...args) => viaFetch(action, args);

    return {
        isReady: () => /^https?:\/\//.test(API_URL),
        mode: () => 'fetch: ' + API_URL,

        checkLogin: (username, password) => call('checkLogin', username, password),
        getMenu: () => call('getMenu'),
        getAllMenuForAdmin: () => call('getAllMenuForAdmin'),
        addMenuItem: (item) => call('addMenuItem', item),
        updateMenuItem: (item) => call('updateMenuItem', item),
        deleteMenuItem: (id) => call('deleteMenuItem', id),
        submitOrder: (order) => call('submitOrder', order),
        getOrdersByDate: (date) => call('getOrdersByDate', date),
        getTables: () => call('getTables'),
        orderFromTable: (tableName, items, orderType) => call('orderFromTable', tableName, items, orderType || 'ทานที่ร้าน'),
        checkoutTable: (tableName, paymentMethod) => call('checkoutTable', tableName, paymentMethod),
        getSalesOverview: (period, customDate, customMonth, startDate, endDate, customYear) => call('getSalesOverview', period || 'all', customDate || null, customMonth || null, startDate || null, endDate || null, customYear || null),
        getRecommendations: (itemNames) => call('getRecommendations', itemNames),
        clearOrderHistory: () => call('clearOrderHistory'),
        getDiscordSettings: () => call('getDiscordSettings'),
        saveDiscordSettings: (settings) => call('saveDiscordSettings', settings),
        triggerDiscordSummary: (reportType, customDate, customMonth, customYear) => call('triggerDiscordSummary', reportType || 'daily', customDate || null, customMonth || null, customYear || null),
        getKitchenOrders: () => call('getKitchenOrders'),
        updateKitchenStatus: (orderId, status) => call('updateKitchenStatus', orderId, status || 'served'),
        openBrowser: (url) => call('openBrowser', url)
    };
})();
