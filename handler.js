const AWS = require('aws-sdk');

const ddb = new AWS.DynamoDB.DocumentClient();
const axios = require('axios');
const cheerio = require('cheerio');
const { App } = require('@slack/bolt');

function getTeamAlerts(teamid) {
	const params = {
			TableName: 'gasbot',
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
	const gasLow = parseInt($('.count.safe_low').text().trim());
	const gasFast = parseInt($('.count.standard').text().trim());
	const gasTrader = parseInt($('.count.fast').text().trim());

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
	const teamAlertsResponse = await getTeamAlerts(teamResponse.team.id);

	// Notify subscribed members if necessary
	const baseText = `ERC20 L1 GAS \n ${ethGasStationMessage} \n ${gasNowMessage}`

	const isTeamAlertExistant = teamAlertsResponse.Items && teamAlertsResponse.Items[0] &&
		teamAlertsResponse.Items[0].subscribers && teamAlertsResponse.Items[0].subscribers.length;

	let subsString = '';
	
	if (isTeamAlertExistant) {
		teamAlertsResponse.Items[0].subscribers.forEach(sub => subsString += ` <@${sub}>`)
		subsString += '\n'
	}

	const text = subsString + baseText;

	// Post message to chat
	await app.client.chat.postMessage({
		text,
		channel: conversationId,
	})
	
};
