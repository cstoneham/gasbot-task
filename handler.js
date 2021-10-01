const AWS = require('aws-sdk');

const ddb = new AWS.DynamoDB.DocumentClient();
const axios = require('axios');
const cheerio = require('cheerio');
const { App } = require('@slack/bolt');
const { get } = require('cheerio/lib/api/traversing');

function getTeamAlerts(teamid, channelid) {
	const params = {
			TableName: 'gasbot',
			Key: {
				teamid,
				channelid,
			 },
	};
	
	return ddb.scan(params).promise();
}

function getGasbotEnabled(teamid) {
	const params = {
		TableName: 'gasbotteams',
		Key: {
			teamid,
		 },
	};

	return ddb.scan(params).promise();
}

// prices {"standard":225,"fast":225,"instant":225}
// source "zapper"
function gasPricesFormatter(prices, source) {
	return `*${source}* \n ${prices.rapid} | ${prices.fast} | ${prices.standard}`
}

module.exports.run = async (event, context) => {
	// Initialize slack app
	const app = new App({
		signingSecret: process.env.SLACK_SIGNING_SECRET,
		token: process.env.SLACK_BOT_TOKEN,
	});

	// Zapper API
	const zapperGasEth = await axios.get('https://api.zapper.fi/v1/gas-price?api_key=5d1237c2-3840-4733-8e92-c5a58fe81b88&network=ethereum&eip1559=false')
	const zapperGasPolygon = await axios.get('https://api.zapper.fi/v1/gas-price?api_key=5d1237c2-3840-4733-8e92-c5a58fe81b88&network=polygon&eip1559=false')
	const zapperGasAvalanche = await axios.get('https://api.zapper.fi/v1/gas-price?api_key=5d1237c2-3840-4733-8e92-c5a58fe81b88&network=avalanche&eip1559=false')

	// API for this guy
	const gasNowRequest = await axios.get('https://www.gasnow.org/api/v3/gas/price?utm_source=yolo');
	const gasNowData = gasNowRequest.data.data;
	const gasNowLow = Math.trunc(gasNowData.standard / 1000000000);
	const gasNowFast = Math.trunc(gasNowData.fast / 1000000000);
	const gasNowTrader = Math.trunc(gasNowData.rapid / 1000000000);
	const gasNowPrices = {
		standard: gasNowLow,
		fast: gasNowFast,
		trader: gasNowTrader,
	}

	// Scrape the Polygon prices
	const respPolygon = await axios.get('https://polygonscan.com/gastracker');
	const $2 = cheerio.load(respPolygon.data); 
	const gasStandardPolygon = parseInt($2('#standardgas').text().trim().replace(' Gwei', ''))
	const gasFastPolygon = parseInt($2('#fastgas').text().trim().replace(' Gwei', ''))
	const gasRapidPolygon = parseInt($2('#rapidgas').text().trim().replace(' Gwei', ''))

	const polyscanPolygonPrices = {
		standard: gasStandardPolygon,
		fast: gasFastPolygon,
		rapid: gasRapidPolygon,
	}

	const gasNowMessage = gasPricesFormatter(gasNowPrices, 'Gas Now')
	const polygonscanMessage = gasPricesFormatter(polyscanPolygonPrices, 'Polygon Scan')
	const zapperAvalancheMessage = gasPricesFormatter(zapperGasAvalanche, 'Zapper')
	const zapperPolygonMessage = gasPricesFormatter(zapperGasEth, 'Zapper')
	const zapperEthMessage = gasPricesFormatter(zapperGasPolygon, 'Zapper')

	// Need to send teamid into this
	const teamResponse = await app.client.team.info()
	const teamid = teamResponse.team.id
	
	let gasbotEnabledResponse = {};
	let isGasbotEnabled = false;

	gasbotEnabledResponse = await getGasbotEnabled(teamid);

	isGasbotEnabled = gasbotEnabledResponse.Items && gasbotEnabledResponse.Items[0] &&
		gasbotEnabledResponse.Items[0].enabled;

	// don't do anything if gasbot isn't enabled
	if (!isGasbotEnabled) {
		return
	}

	// Build notification strings
	const baseText = `----- *ERC20 L1 GAS* ----- \n ${gasNowMessage} \n ${zapperEthMessage}`

	const baseTextPolygon = `----- *POLYGON L2* ----- \n ${polygonscanMessage} \n ${zapperPolygonMessage}`

	const baseTextAvalanche = `----- *AVALANCHE L2* -----  \n ${zapperAvalancheMessage}`

	// const channels = gasbotEnabledResponse.Items[0].channels
	const channels = gasbotEnabledResponse.Items.map(item => item.channelid)

	for (const index in channels) {
		const channel = channels[index];

		// Get alerts for members of that channel
		const teamAlertsResponse = await getTeamAlerts(teamid, channel)
		const isTeamAlertExistant = teamAlertsResponse.Items && teamAlertsResponse.Items[0] &&
			teamAlertsResponse.Items[0].subscribers && teamAlertsResponse.Items[0].subscribers.length;

		let subsString = '';
		
		if (isTeamAlertExistant) {
			teamAlertsResponse.Items[0].subscribers.forEach(sub => subsString += ` <@${sub}>`)
			subsString += '\n'
		}

		const text = `${subsString}${baseText}\n${baseTextPolygon}\n${baseTextAvalanche}\n===================`

		// Post message to chat
		await app.client.chat.postMessage({
			text,
			channel,
		})
	}
};