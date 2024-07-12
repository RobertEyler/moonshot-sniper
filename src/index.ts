import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  Logs,
  PublicKey, TransactionMessage,
  TransactionSignature, VersionedTransaction
} from '@solana/web3.js';
import {logger, TokenMintArgs} from './core';
import {Environment, Moonshot, Token, tokenLaunchpadIdlV1} from '@wen-moon-ser/moonshot-sdk';
import {CurveType} from '@heliofi/launchpad-common';
import bs58 from 'bs58';
import {retry} from './core/retry';
import {CurveAccountLayout, RawCurveAccount} from './curve-account';
import {publicKey, u64} from '@solana/buffer-layout-utils';
import {Layout} from '@solana/buffer-layout';
const rpcEndpoint = process.env.RPC_ENDPOINT;
const wssEndpoint = process.env.WSS_ENDPOINT;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const commitment: Commitment=process.env.COMMITMENT;
const buySol=process.env.BUY_SOL;
const takeProfit = Number(process.env.TAKE_PROFIT);
const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
const microLamports = Number(process.env.MICRO_LAMPORTS);
const timeoutProfit = Number(process.env.TIMEOUT_PROFIT);
const timeoutTime = Number(process.env.TIMEOUT_TIME);
const stopLess = Number(process.env.STOP_LESS);
const simulate = Boolean(process.env.SIMULATE);
const lastTransaction = Number(process.env.LAST_TRANSACTION);
const existMint = new Set<string>();
let balance = BigInt(`${Number(process.env.SIMULATE_BALANCE)*1e9}`);
const existTokenBuy = new Map<string,ExistTokenBuyInfo>();
const disciverMint = new Set<string>();
const allTransactional = new Map<string,Transactional>();
const moonShot = new Moonshot({
  rpcUrl:rpcEndpoint,
  authToken:'',
  environment:Environment.MAINNET
});
type ExistTokenBuyInfo = {
  buyTime:Date,
  buyPrice:bigint,
  buyAmount:bigint,
  tokenMint:PublicKey,
}
type Transactional = {
  mint:string,
  buy:{
    buySol:bigint,
    buyPrice:bigint,
  },
  sell:{
    sellSol:bigint,
    sellPrice:bigint,
  },
  earnSol:bigint,
  isFinish:boolean,
}
enum LogType{
  Buy='Buy',
  Sell='Sell',
  TokenMint='TokenMint',
  Error='Error',
}
const solanaConnection=new Connection(rpcEndpoint,{wsEndpoint:wssEndpoint});


const findLogType=(l:Logs):LogType=>{
  // if(l.err){
  //   logger.error(`the log err: ${l.err.toString()}`);
  //   return LogType.Error;
  // }
  for (const index in l.logs){
    const s = l.logs[index];
    if (s.includes('Instruction: TokenMint')){
      return LogType.TokenMint;
    }
    if (s.includes('Instruction: Buy')){
      return LogType.Buy;
    }
    if (s.includes('Instruction: Sell')){
      return LogType.Sell;
    }
  }
};
const getTokenMintArgs=async (signature:TransactionSignature):Promise<TokenMintArgs>=>{
  const pd = await solanaConnection.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  const instructions = pd.transaction.message.instructions;
  const tokenMintArgs = new TokenMintArgs();
  tokenMintArgs.curveAccount=instructions[1]['accounts'][2];
  tokenMintArgs.mint=instructions[1]['accounts'][3];
  tokenMintArgs.mintMetadata=instructions[1]['accounts'][4];
  tokenMintArgs.curveTokenAccount=instructions[1]['accounts'][5];
  tokenMintArgs.configAccount=instructions[1]['accounts'][6];
  return tokenMintArgs;
};

const getCurvePrice= async (mint:string)=>{
  const t = new Token({
    mintAddress:mint,
    moonshot:moonShot,
    curveType:CurveType.LINEAR_V1
  });
  const price = await t.getCollateralPrice({tokenAmount:BigInt('1000000000')});
  return price;
};
const buy=async (mint:string)=>{
  const token = new Token({
    mintAddress:mint.toString(),
    moonshot:moonShot,
    curveType:CurveType.LINEAR_V1
  });
  const tokenAmount = await token.getTokenAmountByCollateral({
    collateralAmount: BigInt(Number(buySol)*1e9),
    tradeDirection: 'BUY',
  });
  const {ixs} = await token.prepareIxs({
    tokenAmount:tokenAmount,
    collateralAmount: BigInt(Number(buySol)*1e9),
    slippageBps: 100,
    creatorPK: wallet.publicKey.toBase58(),
    tradeDirection: 'BUY',
  });
  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: microLamports,
  });

  const blockhash = await solanaConnection.getLatestBlockhash('confirmed');
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: [priorityIx, ...ixs],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet]);
  const txHash = await solanaConnection.sendTransaction(transaction, {
    skipPreflight: false,
    maxRetries: 0,
    preflightCommitment: 'confirmed',
  });
};
const toBuy=async (mint:string)=>{
  try {
    if (!simulate) {
      await retry(buy, mint, {retries: 10, retryIntervalMs: 50});
    }
    const price = await getCurvePrice(mint);
    allTransactional.set(mint.toString(),{
      mint:mint.toString(),
      buy:{
        buySol:BigInt(Number(buySol)*1000000000),
        buyPrice:price,
      },
      sell:{
        sellSol:BigInt(0),
        sellPrice:BigInt(0),
      },
      earnSol:BigInt(0),
      isFinish:false
    });
    balance -= BigInt(Number(buySol)*1e9);
    logger.info(`Transaction buy success ${buySol} sol`);
    const token = new Token({
      mintAddress:mint,
      moonshot:moonShot,
      curveType:CurveType.LINEAR_V1
    });
    const tokenAmount = await token.getTokenAmountByCollateral({
      collateralAmount: BigInt(Number(buySol)*1e9),
      tradeDirection: 'BUY',
    });
    existMint.add(mint);
    existTokenBuy.set(mint,{
      buyTime:new Date(),
      buyPrice:price,
      buyAmount:tokenAmount,
      tokenMint:new PublicKey(mint),
    });
  }catch (err){
    logger.error(`Buy token ${mint} 10 times fail ${err}`);
  }
};
const sell = async ({mint:mint,tokenAmount:tokenAmount})=>{
  const token = new Token({
    mintAddress:mint,
    moonshot:moonShot,
    curveType:CurveType.LINEAR_V1
  });
  const collateralAmount = await token.getCollateralAmountByTokens({
    tokenAmount: tokenAmount,
    tradeDirection: 'SELL',
  });
  const {ixs} = await token.prepareIxs({
    tokenAmount:tokenAmount,
    collateralAmount: collateralAmount,
    slippageBps: 100,
    creatorPK: wallet.publicKey.toBase58(),
    tradeDirection: 'SELL',
  });
  const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: microLamports,
  });

  const blockhash = await solanaConnection.getLatestBlockhash('confirmed');
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: [priorityIx, ...ixs],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet]);
  const txHash = await solanaConnection.sendTransaction(transaction, {
    skipPreflight: false,
    maxRetries: 0,
    preflightCommitment: 'confirmed',
  });
  logger.info(`Transaction sell success ${txHash}`);
};
const toSell = async (mint:string,buyInfo:ExistTokenBuyInfo)=>{
  if (!existMint.has(mint)){
    return;
  }
  try {
    if (!simulate) {
      await retry(sell, {mint: mint, tokenAmount: buyInfo.buyAmount}, {retries: 10, retryIntervalMs: 50});
    }
    const token = new Token({
      mintAddress:mint,
      moonshot:moonShot,
      curveType:CurveType.LINEAR_V1
    });
    const collateralAmount = await token.getCollateralAmountByTokens({
      tokenAmount: buyInfo.buyAmount,
      tradeDirection: 'BUY',
    });
    const price = await getCurvePrice(mint);
    const transactional = allTransactional.get(mint);
    transactional.sell.sellPrice = price;
    transactional.sell.sellSol = collateralAmount;
    transactional.earnSol = collateralAmount-transactional.buy.buySol;
    transactional.isFinish = true;
    allTransactional.set(mint,transactional);
    balance = balance+collateralAmount;
    logger.info(`mint ${mint} earn ${transactional.earnSol} ,balance is ${balance}`);
    existMint.delete(mint.toString());
    existTokenBuy.delete(mint.toString());
  }catch (err){
    logger.error(`sell token ${mint} 10 times fail ${err}`);
  }
};
const determineSell = async (mintStr:string)=>{
  const mint = new PublicKey(mintStr);
  if (!existMint.has(mint.toString())){
    return;
  }
  const price = await getCurvePrice(mint.toString());
  const buyInfo =existTokenBuy.get(mint.toString());
  const netChange = (price - buyInfo.buyPrice)*BigInt('100')/buyInfo.buyPrice;
  if (netChange>takeProfit){
    await toSell(mint.toString(), buyInfo);
  }
  if (price<buyInfo.buyPrice &&(buyInfo.buyPrice-price)*BigInt('100')/buyInfo.buyPrice > stopLess){
    await toSell(mint.toString(), buyInfo);
  }
  //超时后价格未涨动
  if (new Date().getTime() - buyInfo.buyTime.getTime() > timeoutTime*1000*60 && netChange < timeoutProfit){
    await toSell(mint.toString(), buyInfo);
  }
};
const getMintBuyOrSell = async (signature:string):Promise<PublicKey>=>{
  const pd = await solanaConnection.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  const instructions = pd.transaction.message.instructions;
  for (const instruction of instructions) {
    if(instruction.programId.toBase58()===tokenLaunchpadIdlV1.metadata.address){
      return instruction['accounts'][6];
    }
  }
};
const whetherNewOrNot = async (curveAccount:string)=>{
  try{
    const t = await solanaConnection.getSignaturesForAddress(new PublicKey(curveAccount));
    const last =t[t.length-1].blockTime;
    const now = new Date().getTime() / 1000;
    return now - last < lastTransaction * 60;
  }catch (err){
    return true;
  }
};
const processMonshot = async (curveAccount:string,curveInfo:RawCurveAccount)=>{
  const mint = curveInfo.mint.toString();
  if (existMint.has(mint)){
    await determineSell(curveInfo.mint.toString());
  }else {
    if (disciverMint.has(mint)) {
      return;
    }
    disciverMint.add(mint);
    const isNew = await whetherNewOrNot(curveAccount);
    if (!isNew){
      return;
    }
    // eslint-disable-next-line max-len
    logger.info(`Discover new curve. https://dexscreener.com/solana/${curveAccount}`);
    // eslint-disable-next-line max-len
    logger.info(`curveAccount:${curveAccount} ,totalSupply: ${curveInfo.totalSupply},curveAmount:${curveInfo.curveAmount}, mint is ${curveInfo.mint.toBase58()}`);
    await toBuy(curveInfo.mint.toString());
    return;
  }
};

const start=async ()=> {
  // eslint-disable-next-line max-len
  solanaConnection.onProgramAccountChange(new PublicKey(tokenLaunchpadIdlV1.metadata.address), async (keyedAccountInfo, ctx) => {
    const curveInfo = CurveAccountLayout.decode(keyedAccountInfo.accountInfo.data, 8);
    const curveAccount = keyedAccountInfo.accountId.toBase58();
    await processMonshot(curveAccount, curveInfo);
  }
  );
};

start();

// 24 mint
// 8 totalAmount
// 16 curveAmount
// 0 curveAccount
// const d = bs58.decode('5kqEWmjVv37rDAQCYSN8DiwcssT1dJkw2VjMphNur9thrpbkKn5piyfWjvSH1bTP2ARMzxvP6g8Xqpnm7Lm1Y56WuGRhMU7E9aYpyf2Sz24KxzUihVbMsdYDnAoq64YjZ8C7Mez3Sw2Gf2UDg9ZcMXvn2TE6jfQnK6e2gMHqD2Rz5QAsBWyS2h84RA93Ss8mS2RgAQMZSqvo9ZxrNcSFw1Ppq1ysBJVwWLxLir1uW5yrwioBoCNs288ftGeq5fFsjAUFRJ5HF3aDyD93rj4gsnekJUnBhiekkhAWPtR1r4Ut8o6iL1rstv8cxU9XF57XsTcQYwwFrGadGGS5meELXQ1nwzxrcAzZgM7DqKEW9NwFDwpTjSgDTd8XYbgTxEQ695KaaCRYMC5m2KQs8WpwS2qY5mupJJGsccxQCQ5isa7rdSu33MPHk9isa7Xvy24hxVa99Xvagvfh');
//
// for (let i = 0; i <d.length;i++){
//   try {
//     const layout = u64().decode(d,i);
//     if (layout===BigInt('1000000000000000000')){
//       logger.info(i);
//       logger.info('success');
//     }
//   }catch (err){
//     logger.info(err);
//   }
// }