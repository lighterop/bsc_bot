/**
 * BNB Chain 个人钱包资产变动通知机器人 (Node.js)
 * GitHub: [Your GitHub Link Here]
 */

require('dotenv').config(); // 引入 dotenv 读取环境变量
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ================= 配置区域 =================

// 1. 从环境变量获取 Token，如果没有则报错
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    console.error("❌ 错误: 请在 .env 文件中设置 TELEGRAM_BOT_TOKEN");
    process.exit(1);
}

// 2. BSC RPC 节点 (优先使用环境变量，否则使用默认公共节点)
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';

// 3. 数据保存路径
const DATA_FILE_PATH = path.join(__dirname, 'bot_data.json');

// 4. 默认监控的代币列表 (USDT, USDC, WBNB)
const DEFAULT_TOKENS = [
    '0x55d398326f99059fF775485246999027B3197955', // USDT (BSC)
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC (BSC)
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'  // WBNB (BSC)
];

// ===========================================

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
let provider;

// ... existing code ...
// (保留之前的所有逻辑代码，此处省略中间未变更部分，确保复制时包含之前的完整逻辑)
// 下面是需要保留的完整逻辑结构，请确保不要覆盖掉之前的核心功能函数
// ... existing code ...

// ================= 状态管理 =================
const activeTokens = new Map();
const watchedWallets = new Map();
const userData = new Map();

// ERC-20 ABI
const ERC20_ABI = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

// ================= 数据持久化逻辑 =================

function saveData() {
    try {
        const dataToSave = [];
        userData.forEach((data, chatId) => {
            dataToSave.push({
                chatId: chatId.toString(),
                wallets: Array.from(data.wallets.entries()),
                tokens: Array.from(data.tokens)
            });
        });
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        console.error('[Error] 保存数据失败:', error);
    }
}

function loadData() {
    if (!fs.existsSync(DATA_FILE_PATH)) {
        console.log('[System] 未找到本地数据文件，将创建新的。');
        return;
    }
    try {
        const rawData = fs.readFileSync(DATA_FILE_PATH, 'utf8');
        const parsedData = JSON.parse(rawData);
        parsedData.forEach(user => {
            const chatId = parseInt(user.chatId);
            let walletsMap = new Map();
            if (Array.isArray(user.wallets)) {
                if (user.wallets.length > 0 && typeof user.wallets[0] === 'string') {
                    user.wallets.forEach(addr => walletsMap.set(addr, '默认钱包'));
                } else {
                    walletsMap = new Map(user.wallets);
                }
            }
            const tokens = new Set(user.tokens);
            userData.set(chatId, { wallets: walletsMap, tokens });
            walletsMap.forEach((alias, walletAddr) => {
                const wLower = walletAddr.toLowerCase();
                if (!watchedWallets.has(wLower)) watchedWallets.set(wLower, new Set());
                watchedWallets.get(wLower).add(chatId);
            });
        });
        console.log(`[System] 成功加载 ${parsedData.length} 位用户的配置。`);
    } catch (error) {
        console.error('[Error] 加载数据失败:', error);
    }
}

async function restoreListeners() {
    console.log('[System] 正在恢复用户自定义代币监听...');
    const allCustomTokens = new Set();
    userData.forEach((data) => {
        data.tokens.forEach(token => allCustomTokens.add(token));
    });
    for (const tokenAddr of allCustomTokens) {
        await startTokenListener(tokenAddr).catch(err => {
            console.error(`[Warn] 恢复代币监听失败 ${tokenAddr}: ${err.message}`);
        });
    }
}

// ================= 初始化与连接 =================

async function setupProvider() {
    bot.setMyCommands([
        { command: '/start', description: '🏠 主菜单' },
        { command: '/list', description: '📋 监控列表' },
        { command: '/watch', description: '➕ 添加监控 (地址 备注)' },
        { command: '/unwatch', description: '➖ 移除监控' },
        { command: '/addtoken', description: '🪙 添加代币' },
        { command: '/help', description: '📖 帮助' }
    ]).then(() => console.log('[Telegram] 菜单指令已更新'));

    loadData();

    try {
        provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
        const network = await provider.getNetwork();
        console.log(`[System] 已连接 BSC 网络: Chain ID ${network.chainId}`);
        startNativeBNBListener();
        for (const token of DEFAULT_TOKENS) {
            await startTokenListener(token, true);
        }
        await restoreListeners();
    } catch (error) {
        console.error('[Error] RPC 连接失败，5秒后重试:', error.message);
        setTimeout(setupProvider, 5000);
    }
}

// ================= 核心逻辑 =================

function startNativeBNBListener() {
    console.log('[Monitor] 启动 BNB 本币监控 (Block Scan Mode)');
    provider.on('block', async (blockNumber) => {
        try {
            const block = await provider.getBlock(blockNumber, true);
            if (!block || !block.prefetchedTransactions) return;

            for (const tx of block.prefetchedTransactions) {
                if (tx.value === 0n) continue;
                const fromLower = tx.from.toLowerCase();
                const toLower = tx.to ? tx.to.toLowerCase() : null;
                if (!toLower) continue;

                let receiptData = null;
                const getReceiptData = async () => {
                    if (!receiptData) {
                        const r = await provider.getTransactionReceipt(tx.hash);
                        receiptData = { gasFee: r ? ethers.formatEther(r.gasUsed * r.gasPrice) : '0' };
                    }
                    return receiptData;
                };

                if (watchedWallets.has(fromLower)) {
                    const rData = await getReceiptData();
                    notifyUsers(watchedWallets.get(fromLower), 'OUT', {
                        from: tx.from, to: tx.to, value: tx.value, symbol: 'BNB', decimals: 18,
                        txHash: tx.hash, blockNumber: block.number, blockHash: block.hash,
                        timestamp: block.timestamp, gasFee: rData.gasFee
                    });
                }
                if (watchedWallets.has(toLower)) {
                    const rData = await getReceiptData();
                    notifyUsers(watchedWallets.get(toLower), 'IN', {
                        from: tx.from, to: tx.to, value: tx.value, symbol: 'BNB', decimals: 18,
                        txHash: tx.hash, blockNumber: block.number, blockHash: block.hash,
                        timestamp: block.timestamp, gasFee: rData.gasFee
                    });
                }
            }
        } catch (err) { }
    });
}

async function startTokenListener(tokenAddress, isDefault = false) {
    const addressLower = tokenAddress.toLowerCase();
    if (activeTokens.has(addressLower)) return activeTokens.get(addressLower);

    try {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const [symbol, decimals] = await Promise.all([
            contract.symbol().catch(() => 'UNKNOWN'),
            contract.decimals().catch(() => 18)
        ]);
        console.log(`[Monitor] 启动代币监听: ${symbol} (${tokenAddress})`);
        const onTransfer = async (from, to, value, event) => {
            try {
                const fromLower = from.toLowerCase();
                const toLower = to.toLowerCase();
                const isFromWatched = watchedWallets.has(fromLower);
                const isToWatched = watchedWallets.has(toLower);
                if (!isFromWatched && !isToWatched) return;
                const txHash = event.log.transactionHash;
                const [receipt, block] = await Promise.all([
                    provider.getTransactionReceipt(txHash),
                    provider.getBlock(event.log.blockNumber)
                ]);
                const gasFee = receipt ? ethers.formatEther(receipt.gasUsed * receipt.gasPrice) : 'Unknown';
                const details = {
                    from, to, value, symbol, decimals, txHash,
                    blockNumber: event.log.blockNumber, blockHash: event.log.blockHash,
                    timestamp: block ? block.timestamp : Math.floor(Date.now() / 1000), gasFee
                };
                if (isFromWatched) notifyUsers(watchedWallets.get(fromLower), 'OUT', details);
                if (isToWatched) notifyUsers(watchedWallets.get(toLower), 'IN', details);
            } catch (err) { console.error(`[Event Error] ${symbol}:`, err.message); }
        };
        contract.on('Transfer', onTransfer);
        const tokenData = { symbol, decimals, contract, listener: onTransfer };
        activeTokens.set(addressLower, tokenData);
        return tokenData;
    } catch (error) {
        console.error(`[Error] 无法监听代币 ${tokenAddress}:`, error.message);
        if (!isDefault) throw new Error('无法连接该代币合约');
    }
}

function notifyUsers(chatIds, type, details) {
    const { from, to, value, symbol, decimals, txHash, blockNumber, blockHash, timestamp, gasFee } = details;
    const formattedAmount = ethers.formatUnits(value, decimals);
    if (parseFloat(formattedAmount) < 0.000001) return;
    const amountStr = parseFloat(formattedAmount).toLocaleString(undefined, { maximumFractionDigits: 6 });
    const date = new Date(timestamp * 1000);
    const timeStr = date.toLocaleString('zh-CN', { hour12: false });
    const emoji = type === 'IN' ? '🟢' : '🔴';

    chatIds.forEach(chatId => {
        const userWallets = userData.get(chatId)?.wallets;
        let walletAlias = '';
        if (type === 'IN' && userWallets && userWallets.has(to.toLowerCase())) {
            walletAlias = `(${userWallets.get(to.toLowerCase())})`;
        } else if (type === 'OUT' && userWallets && userWallets.has(from.toLowerCase())) {
            walletAlias = `(${userWallets.get(from.toLowerCase())})`;
        }
        const typeText = type === 'IN' ? `#入账 ${walletAlias}` : `#出账 ${walletAlias}`;
        const message = `
${emoji} <b>交易提醒</b>

<b>交易金额：</b> ${amountStr}
<b>交易类型：</b> ${typeText}
<b>交易币种：</b> #${symbol}
<b>交易消耗：</b> ${parseFloat(gasFee).toFixed(6)} BNB
<b>转出方 ：</b> <code>${from}</code>
<b>收入方 ：</b> <code>${to}</code>
<b>交易哈希：</b> <a href="https://bscscan.com/tx/${txHash}">查看 Hash</a>
<b>区块高度：</b> ${blockNumber}
<b>区块哈希：</b> <code>${blockHash.substring(0, 10)}...</code>
<b>交易时间：</b> ${timeStr}
        `;
        bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    });
}

function addWatchWallet(chatId, walletAddress, alias = '默认钱包') {
    const walletLower = walletAddress.toLowerCase();
    if (!watchedWallets.has(walletLower)) watchedWallets.set(walletLower, new Set());
    watchedWallets.get(walletLower).add(chatId);
    if (!userData.has(chatId)) userData.set(chatId, { wallets: new Map(), tokens: new Set() });
    userData.get(chatId).wallets.set(walletLower, alias);
    saveData();
}

function removeWatchWallet(chatId, walletAddress) {
    const walletLower = walletAddress.toLowerCase();
    if (watchedWallets.has(walletLower)) {
        watchedWallets.get(walletLower).delete(chatId);
        if (watchedWallets.get(walletLower).size === 0) watchedWallets.delete(walletLower);
    }
    if (userData.has(chatId)) userData.get(chatId).wallets.delete(walletLower);
    saveData();
}

// ================= Telegram 指令 & 交互 =================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const msgText = `
👋 <b>欢迎使用 BSC 钱包监控助手!</b>

支持 <b>BNB</b>, <b>USDT</b> 变动实时通知，支持自定义钱包名称。

🔰 <b>快捷操作:</b>
    `;
    const opts = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '➕ 添加监控 (带备注)', switch_inline_query_current_chat: '/watch ' },
                    { text: '📋 我的钱包列表', callback_data: 'btn_list' }
                ],
                [
                    { text: '🪙 添加代币', switch_inline_query_current_chat: '/addtoken ' },
                    { text: '📖 帮助说明', callback_data: 'btn_help' }
                ]
            ]
        }
    };
    bot.sendMessage(chatId, msgText, opts);
});

bot.onText(/\/help/, (msg) => { sendHelpMessage(msg.chat.id); });

function sendHelpMessage(chatId) {
    const helpText = `
📖 <b>使用说明</b>

<b>1. 添加监控 (带备注)</b>
• <code>/watch [地址] [备注名]</code>
  例如: <code>/watch 0x123...abc 主力钱包</code>
  (如果不写备注，默认为"默认钱包")

<b>2. 管理</b>
• <code>/list</code> - 查看所有监控的钱包和备注名。
• <code>/unwatch [地址]</code> - 移除监控。

<b>3. 扩展</b>
• <code>/addtoken [合约地址]</code> - 监控其他代币。
    `;
    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
}

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;
    bot.answerCallbackQuery(query.id);
    if (action === 'btn_help') {
        sendHelpMessage(chatId);
    } else if (action === 'btn_list') {
        const data = userData.get(chatId);
        if (!data || data.wallets.size === 0) {
            bot.sendMessage(chatId, '📭 你还没有监控任何钱包。', { parse_mode: 'HTML' });
            return;
        }
        let report = '📋 <b>当前监控配置:</b>\n\n';
        report += '👀 <b>钱包列表:</b>\n';
        data.wallets.forEach((alias, addr) => {
            report += `└ <b>${alias}</b>\n   <code>${addr}</code>\n`;
        });
        report += '\n🪙 <b>已激活资产:</b>\n└ BNB, USDT, USDC, WBNB (默认)\n';
        if (data.tokens.size > 0) {
            data.tokens.forEach(t => {
                const info = activeTokens.get(t);
                report += `└ ${info ? info.symbol : t}\n`;
            });
        }
        bot.sendMessage(chatId, report, { parse_mode: 'HTML' });
    }
});

bot.onText(/\/watch (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const args = match[1].trim().split(/\s+/);
    const address = args[0];
    const alias = args.slice(1).join(' ') || '默认钱包';
    if (!ethers.isAddress(address)) return bot.sendMessage(chatId, '❌ 钱包地址格式不正确。');
    addWatchWallet(chatId, address, alias);
    bot.sendMessage(chatId, `
✅ <b>监控已添加!</b>
🏷 <b>备注:</b> ${alias}
👀 <b>地址:</b> <code>${address}</code>
    `, { parse_mode: 'HTML' });
});

bot.onText(/\/unwatch (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (!ethers.isAddress(address)) return bot.sendMessage(chatId, '❌ 钱包地址格式不正确。');
    removeWatchWallet(chatId, address);
    bot.sendMessage(chatId, `🗑 已停止监控该钱包: <code>${address}</code>`, { parse_mode: 'HTML' });
});

bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    const data = userData.get(chatId);
    if (!data || data.wallets.size === 0) return bot.sendMessage(chatId, '📭 列表为空。使用 /watch 添加。', { parse_mode: 'HTML' });
    let report = '📋 <b>当前监控配置:</b>\n\n';
    report += '👀 <b>钱包列表:</b>\n';
    data.wallets.forEach((alias, addr) => {
        report += `└ <b>${alias}</b>\n   <code>${addr}</code>\n`;
    });
    report += '\n🪙 <b>已激活资产:</b>\n└ BNB, USDT, USDC, WBNB (默认)\n';
    if (data.tokens.size > 0) {
        data.tokens.forEach(t => {
            const info = activeTokens.get(t);
            report += `└ ${info ? info.symbol : t}\n`;
        });
    }
    bot.sendMessage(chatId, report, { parse_mode: 'HTML' });
});

bot.onText(/\/addtoken (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tokenAddr = match[1].trim();
    if (!ethers.isAddress(tokenAddr)) return bot.sendMessage(chatId, '❌ 代币合约地址格式不正确。');
    bot.sendChatAction(chatId, 'typing');
    try {
        const tokenData = await startTokenListener(tokenAddr);
        if (!userData.has(chatId)) userData.set(chatId, { wallets: new Map(), tokens: new Set() });
        userData.get(chatId).tokens.add(tokenAddr.toLowerCase());
        saveData();
        bot.sendMessage(chatId, `✅ <b>代币添加成功!</b>\n\n🪙 符号: ${tokenData.symbol}\n现在如果你的钱包交易该代币，将会收到通知。`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(chatId, `❌ 添加失败: ${e.message}`); }
});

bot.on('polling_error', (error) => console.log(`[Polling] ${error.code}: ${error.message}`));

console.log('🚀 个人钱包监控机器人已启动 (支持备注功能)...');
setupProvider();