function print(){
    var htmlCode = '';
    const phrase = 'Work in progress';
    for (var i = 0; i < phrase.length; i++) {
		if (phrase[i] == ' '){
			htmlCode += ' ';
		} else {
			htmlCode += '<span class="letter">' + phrase[i] + '</span>';
		}
    }
    document.getElementById('loading-text').innerHTML = htmlCode;
}