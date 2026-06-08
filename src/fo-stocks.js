// NSE F&O Eligible Stocks — Top 100 by liquidity
// Source: NSE F&O segment, filtered by OI and avg daily volume

const FO_STOCKS = [
  // Banking & Finance
  'NSE:HDFCBANK','NSE:ICICIBANK','NSE:SBIN','NSE:AXISBANK','NSE:KOTAKBANK',
  'NSE:BAJFINANCE','NSE:BAJAJFINSV','NSE:INDUSINDBK','NSE:FEDERALBNK',
  'NSE:PFC','NSE:RECLTD','NSE:CANBK','NSE:BANKBARODA','NSE:IDFCFIRSTB',
  'NSE:AUBANK','NSE:RBLBANK','NSE:BANDHANBNK','NSE:M_M','NSE:CHOLAFIN',

  // IT & Tech
  'NSE:TCS','NSE:INFY','NSE:HCLTECH','NSE:WIPRO','NSE:TECHM',
  'NSE:LTIM','NSE:MPHASIS','NSE:COFORGE','NSE:PERSISTENT','NSE:OFSS',

  // Oil, Gas & Energy
  'NSE:RELIANCE','NSE:ONGC','NSE:IOC','NSE:BPCL','NSE:GAIL',
  'NSE:HINDPETRO','NSE:MRPL','NSE:PETRONET','NSE:OIL',

  // Metals & Mining
  'NSE:TATASTEEL','NSE:HINDALCO','NSE:JSWSTEEL','NSE:SAIL','NSE:VEDL',
  'NSE:NATIONALUM','NSE:NMDC','NSE:HINDCOPPER','NSE:COALINDIA',

  // Auto
  'NSE:MARUTI','NSE:TATAMOTORS','NSE:BAJAJ_AUTO','NSE:HEROMOTOCO',
  'NSE:EICHERMOT','NSE:TVSMOTOR','NSE:ASHOKLEY','NSE:MOTHERSON',

  // Pharma & Healthcare
  'NSE:SUNPHARMA','NSE:DRREDDY','NSE:CIPLA','NSE:DIVISLAB',
  'NSE:APOLLOHOSP','NSE:BIOCON','NSE:LUPIN','NSE:AUROPHARMA','NSE:GLAND',

  // FMCG & Consumer
  'NSE:HINDUNILVR','NSE:NESTLEIND','NSE:BRITANNIA','NSE:DABUR',
  'NSE:MARICO','NSE:COLPAL','NSE:GODREJCP','NSE:TATACONSUM',

  // Infrastructure & Construction
  'NSE:LT','NSE:ULTRACEMCO','NSE:GRASIM','NSE:SHREECEM','NSE:AMBUJACEMENT',
  'NSE:ACC','NSE:HAVELLS','NSE:ABB','NSE:SIEMENS','NSE:BHEL',

  // Power & Utilities
  'NSE:POWERGRID','NSE:NTPC','NSE:ADANIGREEN','NSE:TATAPOWER',
  'NSE:CESC','NSE:TORNTPOWER','NSE:JSW ENERGY',

  // Conglomerates & Others
  'NSE:ADANIENT','NSE:ADANIPORTS','NSE:TITAN','NSE:DMART',
  'NSE:PIDILITIND','NSE:BERGEPAINT','NSE:ASIANPAINT','NSE:NAUKRI',
  'NSE:ZOMATO','NSE:PAYTM','NSE:NYKAA','NSE:IRCTC','NSE:POLYCAB',
  'NSE:DIXON','NSE:VOLTAS','NSE:WHIRLPOOL','NSE:MCDOWELL-N',
];

// Multi-asset symbols for non-equity scan
const MULTI_ASSET = {
  CRYPTO: [
    { symbol: 'BITSTAMP:BTCUSD',  name: 'Bitcoin (BTC/USD)',  unit: '$',  emoji: '₿'  },
    { symbol: 'BITSTAMP:ETHUSD',  name: 'Ethereum (ETH/USD)', unit: '$',  emoji: '⟠'  },
  ],
  FOREX: [
    { symbol: 'FX_IDC:USDINR',   name: 'USD/INR',    unit: '₹', emoji: '💵' },
    { symbol: 'FX:EURUSD',       name: 'EUR/USD',    unit: '$', emoji: '💶' },
    { symbol: 'FX:GBPUSD',       name: 'GBP/USD',    unit: '$', emoji: '💷' },
  ],
  METALS: [
    { symbol: 'TVC:GOLD',        name: 'Gold (XAU/USD)',   unit: '$', emoji: '🥇' },
    { symbol: 'TVC:SILVER',      name: 'Silver (XAG/USD)', unit: '$', emoji: '🥈' },
  ],
  CRUDE: [
    { symbol: 'TVC:USOIL',       name: 'Crude Oil (WTI)',  unit: '$', emoji: '🛢️' },
  ],
};

module.exports = { FO_STOCKS, MULTI_ASSET };
