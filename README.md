# lend.js

Automated ordering for Lending Club

The script relies on the following environment variables:
- `LENDINGCLUB_API_KEY` Your API key from Lending Club
- `THIRD_PARTY_KEY` Your third-party API key from Lending Club
- `LENDINGCLUB_ACCOUNT_ID` Your Lending Club account ID (available on your account summary page)
- `LENDINGCLUB_PORTFOLIO_ID` (Optional) The portfolio ID to add any new orders to

Default configuration lives in `default.json`. You can copy this file to `config.json` to override the defaults.

Learn more about Lending Club's API [here](https://www.lendingclub.com/developers/lc-api.action).