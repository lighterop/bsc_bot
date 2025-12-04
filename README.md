# BSC Wallet Monitor Bot 🤖

一个基于 Node.js 的 Telegram 机器人，用于实时监控 BSC (BNB Chain) 链上个人钱包的资金变动。
支持监控 BNB 本币以及 USDT、USDC 等 BEP-20 代币的收入和支出，并支持多用户使用。

## ✨ 主要功能

* **实时通知**：监控钱包的转账（入账/出账），毫秒级响应。
* **多币种支持**：
    * ✅ **原生代币**：BNB
    * ✅ **默认代币**：USDT, USDC, WBNB
    * ✅ **自定义代币**：支持用户手动添加任意 BSC 代币合约
* **详细信息**：通知包含交易金额、Gas 消耗、交易哈希、区块高度及时间。
* **备注功能**：支持给监控地址设置别名（如：工资卡、主钱包）。
* **数据持久化**：使用本地 JSON 存储用户配置，重启不丢失数据。
* **交互友好**：支持 Telegram 菜单按钮和快捷指令。

---

## 🛠 安装与部署

### 1. 克隆项目

```bash
git clone https://github.com/lighterop/bsc_bot.git
cd bsc-wallet-monitor-bot
```

---

### 2. 安装依赖
```bash
npm install
npm install pm2 -g
```

---
### 3. 配置环境变量
复制 .env.example 文件（如果没有，请手动创建 .env 文件），并填入你的配置：
```bash
# Telegram 机器人 Token (从 @BotFather 获取)
TELEGRAM_BOT_TOKEN=你的_TELEGRAM_BOT_TOKEN

# BSC RPC 节点地址 (建议使用 QuickNode/Alchemy 等私有节点以防断连，也可使用公共节点)
BSC_RPC_URL=[https://bsc-dataseed.binance.org/](https://bsc-dataseed.binance.org/)
```

---
### 4. 启动机器人
```bash
pm2 start bsc_bot.js

# 定时重启(凌晨2点)
pm2 start bsc_bot.js --cron "0 2 * * *" 
```

---
## 📖 使用指南
在 Telegram 中向机器人发送 /start 即可开始使用。


| 指令 | 说明 | 示例 |
| :----:| :----: | :----: |
| `/watch [地址] [备注]`| 添加监控钱包（支持备注） | `/watch 0x123...abc 主钱包` |
| `/unwatch [地址]` | 移除监控钱包 | `/unwatch 0x123...abc` |
| `/list`     | 查看当前监控列表     |  `/list`   |
| `/addtoken [合约]`      |  添加自定义代币监控      |  `/addtoken 0x...`  |
---

## 备份
运行后可以在项目目录下找到 `bot_data.json`文件，自行备份数据

---

## 🤝 贡献
欢迎提交 Issue 或 Pull Request 来改进这个项目！

---
## 📸 截图示例
![34274b5c8e69dc9ac70ad40de94c884d.png](https://i.mji.rip/2025/12/04/34274b5c8e69dc9ac70ad40de94c884d.png)

---

## ⚠️ 免责声明

本项目仅供学习和个人使用。请勿用于非法用途。开发者不对因使用本软件产生的任何资产损失负责。














