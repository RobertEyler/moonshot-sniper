import {PublicKey} from '@solana/web3.js';

export class TokenMintArgs{
  curveAccount: PublicKey;
  mint: PublicKey;
  mintMetadata: PublicKey;
  curveTokenAccount: PublicKey;
  configAccount: PublicKey;
}