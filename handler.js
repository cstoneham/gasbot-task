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

module.exports.run = async (event, context) => {
	// Initialize slack app
	const app = new App({
		signingSecret: process.env.SLACK_SIGNING_SECRET,
		token: process.env.SLACK_BOT_TOKEN,
	});

	// Scape the gas prices
	const resp = await axios.get('https://ethgasstation.info/');
	const $ = cheerio.load(resp.data);

	const gasLow = parseInt($('.rgp .safe-low .count').text().trim());
	const gasFast = parseInt($('.rgp .standard .count').text().trim());
	const gasTrader = parseInt($('.rgp .fast .count').text().trim());

	const gasNowRequest = await axios.get('https://www.gasnow.org/api/v3/gas/price?utm_source=yolo');
	const gasNowData = gasNowRequest.data.data;
	const gasNowLow = Math.trunc(gasNowData.standard / 1000000000);
	const gasNowFast = Math.trunc(gasNowData.fast / 1000000000);
	const gasNowTrader = Math.trunc(gasNowData.rapid / 1000000000);

	// const receivers = '<@' + carlosId + '> ' + '<@' + dennisId + '> ' + '<@' + navidId + '>';
	const ethGasStationMessage = '*ETH Gas Station* \n ' +  gasTrader + ' | ' + gasFast + ' | ' + gasLow;
	const gasNowMessage = '*Gas Now* \n' +  gasNowTrader + ' | ' + gasNowFast + ' | ' + gasNowLow;

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
	const baseText = `----- *ERC20 L1 GAS* ----- \n ${ethGasStationMessage} \n ${gasNowMessage}`
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

		const text = subsString + baseText + '\n';

		// Post message to chat
		await app.client.chat.postMessage({
			text,
			channel,
		})
	}
};