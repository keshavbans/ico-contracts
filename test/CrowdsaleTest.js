let Crowdsale = artifacts.require("./Crowdsale.sol");
let DebitumToken = artifacts.require("./DebitumToken.sol");
let MultiSigWallet = artifacts.require("./MultiSigWallet.sol");

contract('Crowdsale.sol', function (accounts) {
    let crowdsale;

    beforeEach('setup contract for each test', async function () {
        let now = Math.round(new Date().getTime()/1000);
        crowdsale = await Crowdsale.new( now, now + 3600, accounts[7], 0, 0, 0, 0, 0, 0);
    });

    it("When hard cap is reached then 60% of token supply is sent", async function () {
        let tokenAmount = await crowdsale.calculateTokenAmountFor(0, web3.toWei(200000.001, 'ether'), {from: accounts[1], gass: 3000000});
        assert.equal(tokenAmount.toNumber(), web3.toWei(600000000, 'ether'), "600M tokens sold");
    });

    it("Should return token rate by raised wei", async function () {
        let rate = await crowdsale.currentRate(0);
        assert.equal(rate.toNumber(), 3750, "First step rate is equal to 3750");

        rate = await crowdsale.currentRate(web3.toWei(4000.0001, 'ether'));
        assert.equal(rate.toNumber(), 3300, "Second step rate is equal to 3300");

        rate = await crowdsale.currentRate(web3.toWei(50000.0001, 'ether'));
        assert.equal(rate.toNumber(), 2888, "Third step rate is equal to 2888");

        rate = await crowdsale.currentRate(web3.toWei(200000.0001, 'ether'));
        assert.equal(rate.toNumber(), 0, "When hard cap is reached then token rate is equal to 0");
    });

    it("Should count left wei till step limit", async function () {
        let epsilon = 0.0001;

        let limit = await crowdsale.weiLimitOfCurrentStep(0);
        assert.equal(limit.toNumber(), web3.toWei(4000, 'ether'), "First step eth limit has to be equal to " + (50000 - 4000));

        limit = await crowdsale.weiLimitOfCurrentStep(web3.toWei(4000, 'ether'));
        assert.equal(limit.toNumber(), web3.toWei(50000 - 4000, 'ether'), "Second step eth limit has to be equal to " + (50000 - 4000));

        limit = await crowdsale.weiLimitOfCurrentStep(web3.toWei(50000, 'ether'));
        assert.equal(limit.toNumber(), web3.toWei(200000 - 50000, 'ether'), "Third step eth limit has to be equal to " + (200000 - 50000));

        limit = await crowdsale.weiLimitOfCurrentStep(web3.toWei(200000 - epsilon, 'ether'));
        assert.equal(limit.toNumber(), web3.toWei(epsilon, 'ether'));
    });

    it("When hard cap is reached then crowdsale is finished", async function() {
        let now = Math.round(new Date().getTime()/1000);
        crowdsale = await Crowdsale.new(
            now,
            now + 3600,
            accounts[7],
            web3.toWei(0.9, 'ether'),
            3750,
            web3.toWei(4, 'ether'),
            3300,
            web3.toWei(5, 'ether'),
            2888
        );

        await crowdsale.signCrowdsaleParticipant(web3.eth.accounts[0], "some-dummy-token");
        await crowdsale.signCrowdsaleParticipant(web3.eth.accounts[1], "some-dummy-token");
        await crowdsale.signCrowdsaleParticipant(web3.eth.accounts[2], "some-dummy-token");

        await crowdsale.sendTransaction(
            {
                from: web3.eth.accounts[0],
                to: contract.address,
                value: web3.toWei(1.3, 'ether'),
            }
        );

        await crowdsale.sendTransaction(
            {
                from: web3.eth.accounts[1],
                to: contract.address,
                value: web3.toWei(2, 'ether'),
            }
        );

        await crowdsale.sendTransaction(
            {
                from: web3.eth.accounts[2],
                to: contract.address,
                value: web3.toWei(2, 'ether'),
            }
        );
        let token = DebitumToken.at(await crowdsale.token());

        await crowdsale.finalizeCrowdsale();
        assert.equal((await token.balanceOf(web3.eth.accounts[0])).toNumber(), web3.toWei(3375 + 1320, 'ether'), "First step investor gets 7500 tokens")
        assert.equal((await token.balanceOf(web3.eth.accounts[1])).toNumber(), web3.toWei(3300 * 2, 'ether'), "Second step investor gets 6600 tokens")
        assert.equal((await token.balanceOf(web3.eth.accounts[2])).toNumber(), web3.toWei(2310 + 2888, 'ether'), "Third step investor gets 5776 tokens")

    });

    it("If minimal cap is not reached till crowdsale end then all investments returned to investors", async function() {
        //given
        let now = Math.round(new Date().getTime()/1000);
        crowdsale = await Crowdsale.new(
            now,
            now + 1,
            accounts[0],
            web3.toWei(9, 'ether'),
            3750,
            web3.toWei(10, 'ether'),
            3300,
            web3.toWei(15, 'ether'),
            2888
        );

        await crowdsale.signCrowdsaleParticipant(web3.eth.accounts[2], "some-dummy-token");


        await crowdsale.sendTransaction(
            {
                from: web3.eth.accounts[2],
                to: contract.address,
                value: web3.toWei(2, 'ether'),
            }
        );
        let initialBalance = web3.eth.getBalance(web3.eth.accounts[2]);

        //when
        while(Math.round(new Date().getTime()/1000) - 3 <= (await crowdsale.endsAt()).toNumber()){}
        await crowdsale.finalizeCrowdsale();

        //then
        assert.equal(initialBalance.toNumber(), web3.eth.getBalance(web3.eth.accounts[2]).toNumber() - web3.toWei(2, 'ether'), "Investment returned to investors")


    });

    it("Must not let invest more then 30eth for not verified investors", async function() {
        //given
        let transferError;
        let NOT_REGISTERED_USER = web3.eth.accounts[1];
        let REGISTERED_USER = web3.eth.accounts[2];
        await crowdsale.signCrowdsaleParticipant(REGISTERED_USER, "some-dummy-token");

        //when
        await crowdsale.sendTransaction(
            {
                from: REGISTERED_USER,
                to: contract.address,
                value: web3.toWei(31, 'ether'),
            }
        );
        try {
            await crowdsale.sendTransaction(
                {
                    from: NOT_REGISTERED_USER,
                    to: contract.address,
                    value: web3.toWei(31, 'ether'),
                }
            );
        } catch(error) {
            transferError = error;
        }

        //then
        assert.notEqual(transferError, undefined, 'Error must be thrown, when not registered user tries to send ether to crowdsale');
    });

    it("Only signer can register crowdsale participant", async function() {
    //given
        let now = Math.round(new Date().getTime()/1000);
        let SIGNER = accounts[0];
        crowdsale = await Crowdsale.new(
            now,
            now + 3600,
            SIGNER,
            web3.toWei(9, 'ether'),
            3750,
            web3.toWei(10, 'ether'),
            3300,
            web3.toWei(15, 'ether'),
            2888
        );
    });

    it("After crowdsale all not sold tokens are transfered to wallet", async function() {
        //given
        let now = Math.round(new Date().getTime()/1000);
        let additionalOwners = accounts.slice(1, 4);
        let wallet = await MultiSigWallet.new(additionalOwners, 2);
        crowdsale = await Crowdsale.new(
            now,
            now + 1,
            wallet.address,
            web3.toWei(9, 'ether'),
            3750,
            web3.toWei(10, 'ether'),
            3300,
            web3.toWei(15, 'ether'),
            2888
        );

        await crowdsale.signCrowdsaleParticipant(web3.eth.accounts[2], "some-dummy-token");

        await crowdsale.sendTransaction(
            {
                from: web3.eth.accounts[2],
                to: contract.address,
                value: web3.toWei(2, 'ether'),
            }
        );

        //when
        while(Math.round(new Date().getTime()/1000) - 3 <= (await crowdsale.endsAt()).toNumber()){}
        await crowdsale.finalizeCrowdsale();
        let token = DebitumToken.at(await crowdsale.token());
        let walletTokenAmount = (await token.balanceOf(wallet.address)).toNumber();
        let investorsTokenAmount = (await token.balanceOf(web3.eth.accounts[2])).toNumber();

        //then
        assert.isTrue(walletTokenAmount > 0, "Wallet has tokens");
        assert.equal((await token.totalSupply()).toNumber() - walletTokenAmount , investorsTokenAmount, "Not sold tokens are transferred to wallet")
    });

});