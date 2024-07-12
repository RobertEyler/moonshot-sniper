import {constant, struct, u32, u8} from '@solana/buffer-layout';
import { bool, publicKey, u64 } from '@solana/buffer-layout-utils';
import { PublicKey } from '@solana/web3.js';
export interface RawCurveAccount {
  totalSupply: bigint;
  curveAmount: bigint;
  mint: PublicKey;
  decimals: number;
  collateralCurrency: ContractCurrency;
  curveType: 0;
  marketcapThreshold: bigint;
  marketcapCurrency: ContractCurveType;
  migrationFee: bigint;
  coefB: number;
  bump: number;
}
export declare enum ContractCurrency {
  SOL = 0
}
export declare enum ContractCurveType {
  LINEAR_V1 = 0
}
export const CurveAccountLayout = struct<RawCurveAccount>([
  u64('totalSupply'),
  u64('curveAmount'),
  publicKey('mint'),
  // u8('decimals'),
  // u8('collateralCurrency'),
  // u8('curveType'),
  // u64('marketcapThreshold'),
  // u8('marketcapCurrency'),
  // u64('migrationFee'),
  // u32('coefB'),
  // u8('bump'),
]);