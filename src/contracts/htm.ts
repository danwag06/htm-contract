import { BSV20V2, Ordinal } from 'scrypt-ord'
import {
    assert,
    bsv,
    ByteString,
    ContractTransaction,
    hash256,
    method,
    MethodCallOptions,
    prop,
    PubKeyHash,
    sha256,
    SigHash,
    toByteString,
    Utils,
} from 'scrypt-ts'

export class HashToMintBsv20 extends BSV20V2 {
    @prop()
    readonly totalSupply: bigint

    @prop(true)
    supply: bigint

    @prop()
    readonly currentReward: bigint

    @prop()
    readonly startingDifficulty: bigint

    constructor(
        sym: ByteString,
        max: bigint,
        dec: bigint,
        currentReward: bigint,
        difficulty: bigint
    ) {
        super(toByteString(''), sym, max, dec)
        this.init(...arguments)

        this.supply = max
        this.currentReward = currentReward
        this.totalSupply = max
        this.startingDifficulty = difficulty

        assert(max % 5n === 0n, 'Supply must be divisible by 5')
        assert(difficulty < 10, 'Max difficulty is 9')
    }

    @method(SigHash.ANYONECANPAY_ALL)
    public redeem(rewardPkh: PubKeyHash, nonce: ByteString) {
        const hash = sha256(this.ctx.utxo.outpoint.txid + nonce)
        for (let i = 0; i < Number(this.calculateDifficulty()); i++) {
            assert(hash[i] === '0', `Difficulty not met`)
        }
        assert(this.ctx.sequence < 0xffffffff, `must use sequence < 0xffffffff`)
        const supply = this.supply - this.currentReward
        this.supply = supply
        let stateOutput = toByteString('')
        if (supply > 0n) {
            stateOutput = this.buildStateOutputFT(supply)
        }
        const rewardOutput = HashToMintBsv20.buildTransferOutput(
            rewardPkh,
            this.id,
            this.currentReward
        )

        const outputs: ByteString =
            stateOutput + rewardOutput + this.buildChangeOutput()
        assert(
            hash256(outputs) === this.ctx.hashOutputs,
            'invalid outputs hash'
        )
    }

    @method()
    calculateDifficulty(): bigint {
        let difficulty = this.startingDifficulty
        const supplyRatio = (this.supply * 100n) / this.totalSupply
        if (supplyRatio < 20n) {
            difficulty = this.startingDifficulty + 4n
        } else if (supplyRatio < 40n) {
            difficulty = this.startingDifficulty + 3n
        } else if (supplyRatio < 60n) {
            difficulty = this.startingDifficulty + 2n
        } else if (supplyRatio < 80n) {
            difficulty = this.startingDifficulty + 1n
        }
        return difficulty
    }

    static async buildTxForRedeem(
        current: HashToMintBsv20,
        options: MethodCallOptions<HashToMintBsv20>,
        rewardPkh: PubKeyHash
    ): Promise<ContractTransaction> {
        const defaultAddress = await current.signer.getDefaultAddress()

        const next = current.next()
        const reward = current.currentReward
        next.supply = current.supply - reward

        if (current.isGenesis()) {
            next.id =
                Ordinal.txId2str(
                    Buffer.from(current.utxo.txId, 'hex')
                        .reverse()
                        .toString('hex')
                ) +
                toByteString('_', true) +
                Ordinal.int2Str(BigInt(current.utxo.outputIndex))
        }

        const tx = new bsv.Transaction().addInput(current.buildContractInput())
        tx.inputs[0].sequenceNumber = options.sequence!

        if (next.supply > 0n) {
            const stateScript =
                BSV20V2.createTransferInsciption(next.id, next.supply) +
                Ordinal.removeInsciption(next.getStateScript())

            const stateOutput = Utils.buildOutput(stateScript, 1n)
            tx.addOutput(
                bsv.Transaction.Output.fromBufferReader(
                    new bsv.encoding.BufferReader(
                        Buffer.from(stateOutput, 'hex')
                    )
                )
            )
        }
        const rewardOutput = HashToMintBsv20.buildTransferOutput(
            rewardPkh,
            next.id,
            reward
        )
        tx.addOutput(
            bsv.Transaction.Output.fromBufferReader(
                new bsv.encoding.BufferReader(Buffer.from(rewardOutput, 'hex'))
            )
        )

        tx.change(options.changeAddress || defaultAddress)
        return { tx, atInputIndex: 0, nexts: [] }
    }
}
