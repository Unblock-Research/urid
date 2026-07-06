import { Module } from "@nestjs/common";
import { CryptoModule } from "./crypto/crypto.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { CredentialsModule } from "./modules/credentials/credentials.module";
import { ZkProofsModule } from "./modules/zk-proofs/zk-proofs.module";
import { AffiliationsModule } from "./modules/affiliations/affiliations.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { ImpactModule } from "./modules/impact/impact.module";

@Module({
  imports: [
    CryptoModule,
    IdentityModule,
    CredentialsModule,
    ZkProofsModule,
    AffiliationsModule,
    WalletModule,
    ImpactModule,
  ],
})
export class AppModule {}
