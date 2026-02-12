// =====================
// NEXUS ULTRA ENGINE
// =====================

class NexusEngine {
    constructor() {
        this.socket = null;
        this.currentMarket = "KRW-BTC";
        this.isRunning = false;
        
        // 자산 관리
        this.balance = 50000000;
        this.holdings = 0;
        this.avgPrice = 0;
        
        // AI 데이터 버퍼
        this.prices = []; // RSI 계산용
        this.trades = []; // 체결 강도 분석용
    }

    async init() {
        // 1. CoinGecko API로 코인 이미지 및 정보 로드
        this.loadCoinInfo('bitcoin');
        
        // 2. 업비트 WebSocket 연결
        this.connectUpbit(this.currentMarket);
        
        // 3. 차트 생성
        this.initChart(this.currentMarket);
        
        // 로딩 종료
        setTimeout(() => document.getElementById('loadingOverlay').classList.add('hidden'), 1500);
    }

    // --- CoinGecko API (REST) ---
    async loadCoinInfo(coinId) {
        try {
            document.getElementById('coingecko-status').classList.add('active');
            const res = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`);
            
            const img = document.getElementById('coin-logo');
            img.src = res.data.image.small;
            img.style.display = 'block';
        } catch (e) {
            console.warn("CoinGecko Load Fail (Rate Limit)");
        }
    }

    // --- Upbit WebSocket (Real-time) ---
    connectUpbit(market) {
        if(this.socket) this.socket.close();
        
        this.socket = new WebSocket("wss://api.upbit.com/websocket/v1");
        this.socket.binaryType = "arraybuffer";

        this.socket.onopen = () => {
            document.getElementById('upbit-status').classList.add('active');
            this.log("UPLINK ESTABLISHED: " + market, "sys");
            const payload = [
                { ticket: "NEXUS_ULTRA" },
                { type: "ticker", codes: [market] },
                { type: "orderbook", codes: [market] },
                { type: "trade", codes: [market] }
            ];
            this.socket.send(JSON.stringify(payload));
        };

        this.socket.onmessage = (evt) => {
            const dec = new TextDecoder();
            const data = JSON.parse(dec.decode(evt.data));

            if(data.type === 'ticker') this.handleTicker(data);
            if(data.type === 'orderbook') this.handleOrderbook(data);
            if(data.type === 'trade') this.handleTrade(data);
        };

        this.socket.onclose = () => {
            document.getElementById('upbit-status').classList.remove('active');
            setTimeout(() => this.connectUpbit(this.currentMarket), 3000); // 자동 재연결
        };
    }

    // --- Data Handlers ---
    handleTicker(data) {
        // UI 갱신
        const priceEl = document.getElementById('live-price');
        const changeEl = document.getElementById('price-change');
        
        priceEl.innerText = data.trade_price.toLocaleString();
        
        const rate = (data.signed_change_rate * 100).toFixed(2);
        const color = data.change === 'RISE' ? 'var(--up)' : (data.change === 'FALL' ? 'var(--down)' : '#fff');
        
        priceEl.style.color = color;
        changeEl.innerText = `${rate}%`;
        changeEl.style.color = color;

        // 통계 갱신
        document.getElementById('high-price').innerText = data.high_price.toLocaleString();
        document.getElementById('low-price').innerText = data.low_price.toLocaleString();
        document.getElementById('volume-24h').innerText = Math.floor(data.acc_trade_volume_24h).toLocaleString();

        // AI 데이터 축적
        this.prices.push(data.trade_price);
        if(this.prices.length > 14) this.prices.shift();
        
        // 자동매매 실행
        if(this.isRunning) this.aiCore(data.trade_price);
    }

    handleOrderbook(data) {
        const list = document.getElementById('ob-list');
        let html = '';
        
        // 매도 (Ask - 파랑) : 가격 높은게 위로, 낮은게 아래로 (역순 정렬 필요)
        // 업비트는 ask_price 오름차순으로 줌 -> 뒤집어서 렌더링
        const asks = [...data.orderbook_units].reverse().slice(0, 8); 
        const bids = data.orderbook_units.slice(0, 8);

        let totalAskSize = data.total_ask_size;
        let totalBidSize = data.total_bid_size;

        // 매도 호가
        asks.forEach(u => {
            const width = Math.min((u.ask_size / totalAskSize) * 500, 100);
            html += `
                <div class="ob-row">
                    <div class="ob-bar ask-bg" style="width:${width}%"></div>
                    <span class="ob-price ask">${u.ask_price.toLocaleString()}</span>
                    <span class="ob-size">${u.ask_size.toFixed(3)}</span>
                </div>`;
        });

        // 매수 호가
        bids.forEach(u => {
            const width = Math.min((u.bid_size / totalBidSize) * 500, 100);
            html += `
                <div class="ob-row">
                    <div class="ob-bar bid-bg" style="width:${width}%"></div>
                    <span class="ob-price bid">${u.bid_price.toLocaleString()}</span>
                    <span class="ob-size">${u.bid_size.toFixed(3)}</span>
                </div>`;
        });

        list.innerHTML = html;

        // 호가 비율 바
        const total = totalAskSize + totalBidSize;
        document.getElementById('bid-ratio').style.width = (totalBidSize / total * 100) + '%';
        document.getElementById('ask-ratio').style.width = (totalAskSize / total * 100) + '%';
    }

    handleTrade(data) {
        const list = document.getElementById('trade-list');
        const div = document.createElement('div');
        div.className = 'trade-row';
        
        const time = new Date(data.timestamp).toLocaleTimeString('ko-KR', {hour12:false});
        const colorClass = data.ask_bid === 'BID' ? 'bid' : 'ask'; // BID=매수(빨강), ASK=매도(파랑)
        
        div.innerHTML = `
            <span style="color:#666">${time}</span>
            <span class="${colorClass}">${data.trade_price.toLocaleString()}</span>
            <span style="color:#888">${data.trade_volume.toFixed(4)}</span>
        `;
        
        list.insertBefore(div, list.firstChild);
        if(list.children.length > 30) list.removeChild(list.lastChild);
    }

    // --- AI Logic ---
    aiCore(currentPrice) {
        // 1. RSI 계산 (간이)
        let rsi = 50;
        if(this.prices.length >= 14) {
            let gains = 0, losses = 0;
            for(let i=1; i<this.prices.length; i++) {
                const diff = this.prices[i] - this.prices[i-1];
                if(diff > 0) gains += diff;
                else losses -= diff;
            }
            const rs = gains / (losses || 1);
            rsi = 100 - (100 / (1 + rs));
        }
        
        document.getElementById('val-rsi').innerText = rsi.toFixed(1);
        
        // 2. 매매 판단
        const r = Math.random(); // 시뮬레이션용 랜덤성 추가
        
        // 매수 로직 (RSI 과매도 + 랜덤 확률)
        if (this.holdings === 0) {
            if (rsi < 35 || r > 0.98) {
                this.buy(currentPrice);
            }
        } 
        // 매도 로직 (익절/손절)
        else {
            const pnlRate = (currentPrice - this.avgPrice) / this.avgPrice;
            // 익절 0.5%, 손절 -0.5% (초단타)
            if (pnlRate > 0.005 || pnlRate < -0.005 || r > 0.99) {
                this.sell(currentPrice);
            }
        }
    }

    buy(price) {
        const amount = this.balance * 0.99; // 99% 매수
        this.holdings = amount / price;
        this.balance -= amount;
        this.avgPrice = price;
        this.balance -= amount * 0.0005; // 수수료
        
        this.log(`BUY EXECUTED @ ${price.toLocaleString()}`, 'buy');
        this.updateWallet();
    }

    sell(price) {
        const revenue = this.holdings * price;
        const fee = revenue * 0.0005;
        this.balance += (revenue - fee);
        
        const pnl = (revenue - fee) - (this.holdings * this.avgPrice);
        this.holdings = 0;
        
        const type = pnl > 0 ? 'buy' : 'sell'; // 이익이면 빨강(buy색), 손해면 파랑
        this.log(`SELL EXECUTED @ ${price.toLocaleString()} (PnL: ${Math.floor(pnl)})`, type);
        this.updateWallet();
    }

    updateWallet() {
        document.getElementById('total-balance').innerHTML = Math.floor(this.balance).toLocaleString() + ' <span class="unit">KRW</span>';
        
        const start = 50000000;
        const diff = this.balance - start;
        const rate = (diff / start) * 100;
        
        const el = document.getElementById('pnl-display');
        el.innerText = `${diff > 0 ? '+' : ''}${Math.floor(diff).toLocaleString()} KRW (${rate.toFixed(2)}%)`;
        el.style.color = diff >= 0 ? 'var(--up)' : 'var(--down)';
    }

    log(msg, type) {
        const box = document.getElementById('terminal-content');
        const div = document.createElement('div');
        div.className = `log-line ${type}`;
        const time = new Date().toLocaleTimeString();
        div.innerText = `[${time}] ${msg}`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    initChart(market) {
        const symbol = "UPBIT:" + market.replace("KRW-", "") + "KRW";
        new TradingView.widget({
            "container_id": "tv_chart",
            "symbol": symbol,
            "interval": "1",
            "theme": "dark",
            "style": "1",
            "locale": "kr",
            "toolbar_bg": "#000",
            "enable_publishing": false,
            "hide_side_toolbar": true,
            "allow_symbol_change": false,
            "autosize": true
        });
    }
}

// Global Instance
const nexus = new NexusEngine();

window.onload = () => nexus.init();

function changeMarket(market) {
    nexus.currentMarket = market;
    nexus.log("SWITCHING MARKET TO " + market, "sys");
    
    // 코인 아이디 매핑 (CoinGecko용)
    const map = {'KRW-BTC':'bitcoin', 'KRW-ETH':'ethereum', 'KRW-XRP':'ripple', 'KRW-SOL':'solana', 'KRW-DOGE':'dogecoin', 'KRW-ZRX':'0x'};
    nexus.loadCoinInfo(map[market]);
    
    nexus.connectUpbit(market);
    nexus.initChart(market);
}

function toggleSystem() {
    const btn = document.getElementById('btn-start');
    nexus.isRunning = !nexus.isRunning;
    
    if(nexus.isRunning) {
        btn.innerHTML = '<i class="fas fa-stop"></i> SYSTEM DISENGAGE';
        btn.classList.add('running');
        nexus.log("AUTO-TRADING SYSTEM ACTIVATED.", "sys");
    } else {
        btn.innerHTML = '<i class="fas fa-power-off"></i> SYSTEM ENGAGE';
        btn.classList.remove('running');
        nexus.log("SYSTEM HALTED.", "sys");
    }
}
